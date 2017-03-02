const MemStorage = require( '../MemStorage' );

class DumbActor {
	constructor( id ) {
		this.id = id;
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
} );