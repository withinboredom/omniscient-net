const Storage = require( '../MemStorage' );
const uuid = require( 'uuid/v4' );

class DumbActor {
	constructor( id ) {
		this.id = id;
		this.instanceId = uuid();
		this.version = 0;
	}

	Id() {
		return this.id;
	}

	createEvent( name, data, version = this.version ++ ) {
		return {
			id: [ this.id, version ],
			model_id: this.id,
			fired_by: 'manual',
			name,
			version,
			data
		};
	}
}

const sleep = ( time ) => new Promise( ( resolve ) => {
	setTimeout( resolve, time );
} );

parameters = [
	'localhost',
	'testAll'
];

describe( 'memstorage storage device', () => {
	it( 'returns an empty array when loading non-existant stream', async() => {
		const storage = new Storage( ...parameters );
		await storage.doMigrations( parameters[ 1 ] );
		const events = await storage.LoadEvents( 'nope' );
		expect( events ).toEqual( [] );
		await storage.Close();
	} );

	it( 'returns past events when loading an existent stream', async() => {
		const storage = new Storage( ...parameters );
		await storage.doMigrations( parameters[ 1 ] );
		const id = uuid();
		const history = [
			{
				id: [ id, 0 ],
				version: 0,
				model_id: id,
				name: 'test',
				data: {}
			}
		];
		await storage.Inject( id, history );
		const events = await storage.LoadEvents( id );
		expect( events ).toEqual( history );

		const empty = await storage.LoadEvents( id, 1 );
		expect( empty ).toEqual( [] );
		await storage.Close();
	} );

	it( 'can store an event', async() => {
		const storage = new Storage( ...parameters );
		await storage.doMigrations( parameters[ 1 ] );
		const id = uuid();
		const test = new DumbActor( id );
		const events = [
			{
				id: [ id, 0 ],
				model_id: id,
				name: 'tester',
				version: 0,
				data: {},
				fired_by: uuid()
			}
		];
		const newEvents = await storage.Store( test, events );
		expect( newEvents ).toEqual( events );

		const stored = await storage.LoadEvents( id );
		expect( stored ).toEqual( events );
		await storage.Close();
	} );

	it( 'waits for a lock to be released before finalizing', async() => {
		const storage = new Storage( ...parameters );
		await storage.doMigrations( parameters[ 1 ] );
		const id = uuid();
		const test = new DumbActor( id );
		const events = [
			{
				id: [ id, 0 ],
				model_id: id,
				fired_by: 'manual',
				name: 'nothing',
				version: 0,
				data: {}
			}
		];

		await storage.SoftLock( test );
		const lock = storage.Store( test, events );
		const nothing = await storage.LoadEvents( id );
		expect( nothing ).toEqual( [] );
		await storage.Unlock( test );
		await lock;
		const stored = await storage.LoadEvents( id );
		expect( stored ).toEqual( events );
		storage.Close();
	} );

	it( 'locks', async() => {
		const storage = new Storage( ...parameters );
		await storage.doMigrations( parameters[ 1 ] );
		const id = uuid();
		const test = new DumbActor( id );

		storage.SoftLock( test );
		expect( storage.IsLocked( test ) ).toBe( true );
		expect( storage.IsHardLocked( test ) ).toBe( false );

		storage.HardLock( test );
		expect( storage.IsLocked( test ) ).toBe( true );
		expect( storage.IsHardLocked( test ) ).toBe( true );

		storage.Unlock( test );
		expect( storage.IsLocked( test ) ).toBe( false );
		expect( storage.IsHardLocked( test ) ).toBe( false );
		storage.Close();
	} );

	it( 'soft locks an instance', async() => {
		const storage = new Storage( ...parameters );
		await storage.doMigrations( parameters[ 1 ] );
		const id = uuid();
		const test1 = new DumbActor( id );
		const test2 = new DumbActor( id );

		const gotLock = storage.SoftLock( test1 );
		expect( gotLock ).toBe( true );
		const originalLock = storage.WaitLock( test1 );

		const noLock = storage.SoftLock( test1 );
		expect( noLock ).toBe( false );
		const nextLock = storage.WaitLock( test1 );

		storage.SoftLock( test2 );
		const notLock = storage.WaitLock( test2 );

		expect( originalLock === nextLock ).toBe( true );
		expect( notLock !== originalLock ).toBe( true );

		storage.Unlock( test1 );
		storage.Unlock( test2 );
		storage.Close();
	} );

	it( 'hard locks an Id', async() => {
		const storage = new Storage( ...parameters );
		await storage.doMigrations( parameters[ 1 ] );
		const id = uuid();
		const test1 = new DumbActor( id );
		const test2 = new DumbActor( id );

		storage.SoftLock( test1 );
		storage.SoftLock( test2 );
		expect( storage.IsLocked( test1 ) ).toBeTruthy();
		expect( storage.IsLocked( test2 ) ).toBeTruthy();
		const gotLock = storage.HardLock( test1 );
		expect( gotLock ).toBe( true );
		expect( storage.IsHardLocked( test2 ) ).toBeFalsy();
		expect( storage.IsHardLocked( test1 ) ).toBeTruthy();
		const noLock = storage.HardLock( test2 );
		expect( noLock ).toBe( false );
		expect( storage.IsHardLocked( test2 ) ).toBeTruthy();
		expect( storage.IsHardLocked( test1 ) ).toBeTruthy();

		expect( storage.IsLocked( test2 ) ).toBeTruthy();

		const wait = [
			storage.WaitLock( test1 ),
			storage.WaitLock( test2 )
		];
		storage.Unlock( test1 );
		await Promise.all( wait );

		expect( storage.SoftLock( test2 ) ).toBeTruthy();
		storage.Close();
	} );

	it( 'subscribes and unsubscribes to actor ids', async() => {
		const storage = new Storage( ...parameters );
		storage.doMigrations( parameters[ 1 ] );
		const cb = jest.fn();
		const id = uuid();
		const actor = new DumbActor( id );

		const prev = actor.createEvent( 'prev', {} );
		await storage.Store( actor, [ prev ] );
		const event = actor.createEvent( 'test', {} );

		await storage.SubscribeTo( id, cb );
		await storage.Store( actor, [ event ] );

		await sleep( 100 );

		expect( cb.mock.calls.length ).toBe( 2 );

		await storage.Unsubscribe( id, cb );
		await storage.Store( actor, [ actor.createEvent( 'test', {} ) ] );

		await sleep( 100 );

		expect( cb.mock.calls.length ).toBe( 2 );

		storage.Close();
	} );

	it( 'subscribes and unsubscribes to event names', async() => {
		const storage = new Storage( ...parameters );
		storage.doMigrations( parameters[ 1 ] );
		const cb = jest.fn();
		const id = uuid();
		const name = uuid();
		const actor = new DumbActor( id );

		const prev = actor.createEvent( name, {} );
		const event = actor.createEvent( name, {} );
		const next = actor.createEvent( name, {} );

		await storage.Store( actor, [ prev ] );

		await storage.SubscribeToName( name, cb );
		await storage.Store( actor, [ event ] );

		await sleep( 500 );

		expect( cb.mock.calls.length ).toBe( 1 );

		await storage.Unsubscribe( name, cb );

		await storage.Store( actor, [ next ] );

		await sleep( 100 );

		expect( cb.mock.calls.length ).toBe( 1 );

		storage.Close();
	} );
} );