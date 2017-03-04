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
		expect( actor.test.mock.calls[ 0 ][ 0 ] ).toEqual( {} );
	} );

	it( 'Sets projector on fire', async() => {
		const storage = new FakeStorage();
		storage.LoadSnapshot = jest.fn();
		storage.SubscribeTo = jest.fn();
		storage.SetProjector = jest.fn();
		storage.SetSnapshot = jest.fn();
		storage.Store = jest.fn();
		const actor = new Actor( '123', storage );
		actor.Project = jest.fn();
		actor.Snapshot = jest.fn();

		await actor.Load(); //noop
		await actor.Fire( 'test', {} );
		expect( storage.SetProjector.mock.calls.length ).toBe( 1 );
		expect( storage.SetSnapshot.mock.calls.length ).toBe( 1 );

		storage.SetProjector.mock.calls[ 0 ][ 1 ]();
		storage.SetSnapshot.mock.calls[ 0 ][ 1 ]();

		expect( actor.Project.mock.calls.length ).toBe( 1 );
		expect( actor.Snapshot.mock.calls.length ).toBe( 1 );
	} );

	it( 'Stores', async() => {
		const storage = new FakeStorage();
		storage.LoadSnapshot = jest.fn();
		storage.SubscribeTo = jest.fn();
		storage.Store = jest.fn();
		const actor = new Actor( '123', storage );
		await actor.Load();
		await actor.Store();

		expect( storage.Store.mock.calls.length ).toBe( 1 );
	} );

	it( 'can load a snapshot', async() => {
		const state = {
			state: {
				test: true
			},
			version: 10
		};
		const storage = new FakeStorage();
		storage.LoadSnapshot = jest.fn( () => {
			return state;
		} );
		storage.SubscribeTo = jest.fn();
		const actor = new Actor( '123', storage );
		await actor.Load();
		expect( actor.state ).toEqual( state.state );
		expect( actor.nextVersion ).toBe( 11 );
	} );

	it( 'unsubscribes when destroyed', async() => {
		const storage = new FakeStorage();
		storage.LoadSnapshot = jest.fn();
		storage.SubscribeTo = jest.fn();
		storage.Unsubscribe = jest.fn();
		const actor = new Actor( '123', storage );
		await actor.Load();
		actor.ListenFor( '345', 'none', 'none' );
		actor.Destroy();

		expect( storage.Unsubscribe.mock.calls.length ).toBe( 2 );
	} );

	it( 'notifies you if fire succeeded', async() => {
		const storage = new FakeStorage();
		storage.LoadSnapshot = jest.fn();
		storage.SubscribeTo = jest.fn();
		storage.SetProjector = jest.fn();
		storage.SetSnapshot = jest.fn();
		storage.Store = jest.fn( () => true );
		const actor = new Actor( '123', storage );
		await actor.Load();
		const success = jest.fn();
		await actor.Fire( 'test', {}, success );

		expect( success.mock.calls.length ).toBe( 1 );
	} );

	it( 'will unsub after listening a certain number of times', async() => {
		const storage = new FakeStorage();
		storage.LoadSnapshot = jest.fn();
		storage.SubscribeTo = jest.fn();
		storage.SetProjector = jest.fn();
		storage.SetSnapshot = jest.fn();
		storage.Store = jest.fn();
		const actor = new Actor( '123', storage );
		await actor.Load();
		actor.ListenFor( 'test', 'hi', 'test_fired_hi', 1 );

		const eventNope = {
			data: {
				test: true
			},
			name: 'nope'
		};

		expect( actor.subs.length ).toBe( 2 );
		await storage.SubscribeTo.mock.calls[ 1 ][ 1 ]( eventNope );
		expect( actor.subs.length ).toBe( 2 );

		const event = {
			data: {
				test: false
			},
			name: 'hi'
		};

		await storage.SubscribeTo.mock.calls[ 1 ][ 1 ]( event );
		expect( actor.subs.length ).toBe( 1 );
	} );

	it( 'will stop listening for an event after a timeout', async() => {
		jest.useFakeTimers();
		const storage = new FakeStorage();
		storage.LoadSnapshot = jest.fn();
		storage.SubscribeTo = jest.fn();
		storage.SetProjector = jest.fn();
		storage.SetSnapshot = jest.fn();
		storage.Store = jest.fn();
		const actor = new Actor( '123', storage );
		await actor.Load();
		actor.ListenFor( 'test', 'hi', 'test_fired_hi', 1 );

		const eventNope = {
			data: {
				test: true
			},
			name: 'nope'
		};

		expect( actor.subs.length ).toBe( 2 );
		await storage.SubscribeTo.mock.calls[ 1 ][ 1 ]( eventNope );
		expect( actor.subs.length ).toBe( 2 );

		jest.runAllTimers();
		expect( actor.subs.length ).toBe( 1 );

		jest.useRealTimers();
	} );
} );