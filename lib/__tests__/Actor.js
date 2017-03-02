const Actor = require( '../Actor' );

class FakeStorage {

}

describe( 'an actor', () => {
	it( 'can be instantiated', () => {
		const actor = new Actor( '123', new FakeStorage() );
		expect( actor.Id() ).toBe( '123' );
	} );

	it( 'can load', async() => {
		const storage = new FakeStorage();
		storage.LoadSnapshot = jest.fn();
		storage.SubscribeTo = jest.fn();
		const actor = new Actor( '123', storage );
		actor.test = jest.fn();

		await actor.Load();
		expect( storage.LoadSnapshot.mock.calls.length ).toBe( 1 );
		expect( storage.LoadSnapshot.mock.calls ).toEqual( [ [ actor ] ] );

		expect( storage.SubscribeTo.mock.calls.length ).toBe( 1 );
		const event = actor.CreateEvent( 'test', {} );
		event.fired_by = 'something else';
		await storage.SubscribeTo.mock.calls[ 0 ][ 1 ]( event );

		expect( actor.test.mock.calls.length ).toBe( 1 );
	} );

	it( 'can fire an event', async() => {
		const storage = new FakeStorage();
		storage.LoadSnapshot = jest.fn();
		storage.SubscribeTo = jest.fn();
		storage.SetProjector = jest.fn();
		storage.SetSnapshot = jest.fn();
		storage.Store = jest.fn();
		const actor = new Actor( '123', storage );
		actor.test = jest.fn();

		await actor.Load(); //noop
		await actor.Fire( 'test', {} );
		expect( storage.Store.mock.calls.length ).toBe( 1 );
		expect( actor.test.mock.calls.length ).toBe( 1 );
		expect(actor.test.mock.calls[0][0]).toEqual({});
	} );
} );