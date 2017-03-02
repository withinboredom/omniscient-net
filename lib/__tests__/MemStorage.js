const MemStorage = require( '../MemStorage' );
const uuid = require( 'uuid/v4' );

class DumbActor {
	constructor( id ) {
		this.id = id;
		this.instanceId = uuid();
	}

	Id() {
		return this.id;
	}
}

describe( 'memory storage device', () => {
	it( 'returns an empty array when loading non-existant stream', async() => {
		const storage = new MemStorage();
		const events = await storage.LoadEvents( 'nope' );
		expect( events ).toEqual( [] );
	} );

	it( 'returns past events when loading an existent stream', async() => {
		const storage = new MemStorage();
		const history = [ { version: 0 } ];
		storage.Inject( '123', history );
		const events = await storage.LoadEvents( '123' );
		expect( events ).toEqual( history );

		const empty = await storage.LoadEvents( '123', 1 );
		expect( empty ).toEqual( [] );
	} );

	it( 'can store an event', async() => {
		const storage = new MemStorage();
		const test = new DumbActor( '123' );
		const events = [
			{
				name: 'nothing',
				version: 0,
				data: {}
			}
		];
		const newEvents = await storage.Store( test, events );
		expect( newEvents ).toEqual( events );

		const stored = await storage.LoadEvents( '123' );
		expect( stored ).toEqual( events );
	} );

	it( 'waits for a lock to be released before finalizing', async() => {
		const storage = new MemStorage();
		const test = new DumbActor( '123' );
		const events = [
			{
				name: 'nothing',
				version: 0,
				data: {}
			}
		];

		await storage.SoftLock( test );
		const lock = storage.Store( test, events );
		const nothing = await storage.LoadEvents( '123' );
		expect( nothing ).toEqual( [] );
		await storage.Unlock( test );
		await lock;
		const stored = await storage.LoadEvents( '123' );
		expect( stored ).toEqual( events );
	} );

	it( 'locks', () => {
		const storage = new MemStorage();
		const test = new DumbActor( '123' );

		storage.SoftLock( test );
		expect( storage.IsLocked( test ) ).toBe( true );
		expect( storage.IsHardLocked( test ) ).toBe( false );

		storage.HardLock( test );
		expect( storage.IsLocked( test ) ).toBe( true );
		expect( storage.IsHardLocked( test ) ).toBe( true );

		storage.Unlock( test );
		expect( storage.IsLocked( test ) ).toBe( false );
		expect( storage.IsHardLocked( test ) ).toBe( false );
	} );

	it( 'soft locks an instance', () => {
		const storage = new MemStorage();
		const test1 = new DumbActor( '123' );
		const test2 = new DumbActor( '123' );

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
	} );

	it( 'hard locks an Id', async () => {
		const storage = new MemStorage();
		const test1 = new DumbActor( '123' );
		const test2 = new DumbActor( '123' );

		storage.SoftLock( test1 );
		storage.SoftLock( test2 );
		expect(storage.IsLocked(test1)).toBeTruthy();
		expect(storage.IsLocked(test2)).toBeTruthy();
		const gotLock = storage.HardLock( test1 );
		expect( gotLock ).toBe( true );
		expect(storage.IsHardLocked(test2)).toBeFalsy();
		expect(storage.IsHardLocked(test1)).toBeTruthy();
		const noLock = storage.HardLock( test2 );
		expect( noLock ).toBe( false );
		expect(storage.IsHardLocked(test2)).toBeTruthy();
		expect(storage.IsHardLocked(test1)).toBeTruthy();

		expect(storage.IsLocked(test2)).toBeTruthy();

		const wait = [
			storage.WaitLock( test1 ),
			storage.WaitLock( test2 )
		];
		storage.Unlock(test1);
		await Promise.all(wait);

		expect(storage.SoftLock(test2)).toBeTruthy();
	} );
} );