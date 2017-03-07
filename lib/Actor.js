const uuid = require( 'uuid/v4' );

/**
 * To use an Actor, simply create a class that extends actor.
 * You may want to override a few things, such as `Project()`
 * which allows you store the state in an easy to query place,
 * such as MySQL, Postgres, Redis, etc.
 *
 * Never forget to call `Destroy()` after you're finished with
 * an Actor's instance, otherwise you'll end up with a memory leak.
 *
 * ```js
 * import { Actor } from 'omniscient-net';
 * class MyActor extends Actor {
 *   Project() {
 *     rdb.replace(this.Id(), this.state);
 *   }
 * }
 * ```
 * Actors are the powerful building blocks of `omniscient-net`,
 * they are kept in synchronization across all instances. This
 * allows you to create long running services without the need
 * to poll or call a RESTful endpoint to manage global state.
 */
class Actor {
	/**
	 * Creates a new Actor
	 * @param {string} id The id of the actor
	 * @param {Storage} storage The storage device
	 * @constructor
	 */
	constructor( id, storage ) {
		/**
		 * The stream id this actor is associated with
		 * @type {string}
		 * @protected
		 */
		this.id = id;

		/**
		 * The unique instance id
		 * @type {string}
		 * @public
		 * @readonly
		 */
		this.instanceId = uuid();

		/**
		 * The storage device
		 * @type {Storage}
		 * @protected
		 */
		this.storage = storage;

		/**
		 * The next version number of an event to fire
		 * @type {number}
		 * @protected
		 */
		this.nextVersion = 0;

		/**
		 * The internal state
		 * @type {{}}
		 * @protected
		 */
		this.state = {};

		/**
		 * Whether or not the actor is currently replaying
		 * @type {boolean}
		 * @protected
		 * @readonly
		 */
		this.replaying = false;

		/**
		 * Any current subscriptions
		 * @type {Array}
		 * @protected
		 * @readonly
		 */
		this.subs = [];
	}

	/**
	 * Once an instance has `.Load()` called on it, it must have
	 * `.Destroy()` called so that it may be GC'd in the future.
	 * Forgetting to do this will result in a memory leak.
	 * @access public
	 */
	Destroy() {
		this.subs.forEach( ( sub ) => {
			this.storage.Unsubscribe( sub[ 0 ], sub[ 1 ] );
		} );
	}

	/**
	 * Register to listen for another actor's events. Allowing to
	 * listen for a certain number of times or for a specified
	 * amount of time. You can listen forever by passing `Infinity`
	 * as the `number` or `time`.
	 * @access protected
	 * @param {string} id The stream id to listen to
	 * @param {string} eventToHear The event to listen for
	 * @param {string} eventToFire The event to fire when the event is heard
	 * @param {int} number The number of times to fire
	 * @param {int} time The number of milliseconds to listen for
	 */
	ListenFor( id, eventToHear, eventToFire, number = 1, time = 60000 ) {
		const wait = async( event ) => {
			if ( event.name == eventToHear ) {
				number -= 1;
				await this.Fire( eventToFire, event.data );
			}

			if ( number <= 0 ) {
				try {
					this.subs = this.subs
					                .filter( ( sub ) => sub[ 0 ] !== id && sub[ 1 ] !== wait );
					this.storage.Unsubscribe( id, wait );
				} catch ( err ) {
				}
			}
		};
		this.subs.push( [ id, wait ] );
		this.storage.SubscribeTo( id, wait );

		if ( time < Infinity ) {
			setTimeout( () => {
				if ( number > 0 ) {
					try {
						this.subs = this.subs
						                .filter( ( sub ) => sub[ 0 ] !== id && sub[ 1 ] !== wait );
						this.storage.Unsubscribe( id, wait );
					} catch ( err ) {
					}
				}
			}, time );
		}
	}

	/**
	 * Applies a snapshot to the state
	 * @access private
	 * @returns {Promise.<object>} A promise that resolves the loaded snapshot
	 */
	async ApplySnapshot() {
		let latestSnapshot = await this.storage.LoadSnapshot( this );

		if ( latestSnapshot ) {
			this.state = latestSnapshot.state;
			this.nextVersion = latestSnapshot.version + 1;
		} else {
			latestSnapshot = {
				version: 0 - 1
			};
			this.nextVersion = 0;
		}

		return latestSnapshot;
	}

	/**
	 * Load must be called after creating the instance, for example:
	 *
	 * ```js
	 * const actor = new Actor( id, storage );
	 * await actor.Load();
	 * ```
	 *
	 * @access public
	 * @returns {Promise.<void>} A promise that resolves once the state is loaded and new events are subscribed to
	 */
	async Load() {
		const latestSnapshot = await this.ApplySnapshot();

		const cb = async( event ) => await this.ApplyEvent( event, true );
		this.subs.push( [ this.Id(), cb ] );

		await this.storage.SubscribeTo( this.Id(), cb, latestSnapshot.version );
	}

	/**
	 * Apply event to instance
	 * @access private
	 * @param {object} event The event to apply
	 * @param {boolean} replay Whether or not this is a replay event
	 * @returns {Promise.<void>} A promise that resolves once the event has been applied
	 */
	async ApplyEvent( event, replay = true ) {
		if ( replay && event.fired_by == this.instanceId ) {
		} else {
			this.replaying = replay;
			const func = event.name;
			this.nextVersion = Math.max( event.version + 1, this.nextVersion );
			if ( this[ func ] ) {
				await this[ func ]( event.data, event );
			}
			this.replaying = false;
		}
	}

	/**
	 * After an event is fired and applied, this method is called. You
	 * can use it to project your state for easy querying, such as an
	 * RDB or some other database.
	 * @access protected
	 * @returns {Promise.<void>} A promise that resolves once the actor has been projected
	 */
	async Project() {
	}

	/**
	 * Resolves when all events have been stored by this instance,
	 * returns false if it failed, otherwise an array of events
	 * that were stored successfully.
	 * @access public
	 * @see {@link #RqlStorage#Store}
	 * @returns {Promise.<Array|boolean>} A promise that resolves once all events have been persisted
	 */
	async Store() {
		return await this.storage.Store( this, [], true );
	}

	/**
	 * Simply returns `this.state`, but you can override this to
	 * persist different objects.
	 * @access protected
	 * @returns {Promise.<Object>} A promise that resolves to a snapshot of the current state
	 */
	async Snapshot() {
		return this.state;
	}

	/**
	 * Simply returns `this.id`
	 * @access public
	 * @returns {string} A string of this instance's stream id
	 */
	Id() {
		return this.id;
	}

	/**
	 * Firing an event will immediately apply the event and persist it to storage.
	 *
	 * Returns a promise that resolves once the event has been applied and broadcast
	 * @access protected
	 * @param {string} name The name of the event
	 * @param {Object} data The data payload of the event
	 * @param {FireSuccessCallback|null} successCallback A callback to call if the fire was a success
	 * @returns {Promise.<void>} A promise that resolves once the event has been applied and broadcast
	 */
	async Fire( name, data, successCallback = null ) {
		const event = this.CreateEvent( name, data );
		this.storage.SetProjector( this, async() => {
			if ( ! this.replaying ) {
				await this.Project();
			}
		} );

		this.storage.SetSnapshot( this, async() => {
			return await this.Snapshot();
		} );

		await this.ApplyEvent( event, false );

		const result = await this.storage.Store( this, [ event ], true );

		if ( result && result !== false && successCallback ) {
			successCallback();
		}
	}

	/**
	 * Creates an event construct from name and data
	 * @access private
	 * @param {string} name The name of the event
	 * @param {Object} data The data payload
	 * @returns {{id: Array, model_id: string, version: (number|*), type: string, name: *, data: *, stored: boolean, at: Date, fired_by: *}} The event
	 */
	CreateEvent( name, data ) {
		return {
			id: [ this.Id(), this.nextVersion ],
			model_id: this.Id(),
			version: this.nextVersion,
			type: 'event',
			name,
			data,
			stored: false,
			at: new Date(),
			fired_by: this.instanceId
		};
	}
}

/**
 * Called when a successful firing occurs
 * @callback FireSuccessCallback
 */

/**
 * @callback Actor~SnapshotCallback
 * @returns {Object} The snapshot of the current state
 */

/**
 * Projector Callback
 * @callback Actor~ProjectorCallback
 */

/**
 * Called on events
 * @callback Actor~OnEvent
 * @param {Object} event The raw event object
 */

module.exports = Actor;