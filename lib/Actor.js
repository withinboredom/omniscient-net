const uuid = require( 'uuid/v4' );

class Actor {
	/**
	 * Creates a new Actor
	 * @param {string} id The id of the actor
	 * @param {Storage} storage The storage device
	 * @constructor
	 */
	constructor( id, storage ) {
		this.id = id;
		this.instanceId = uuid();
		this.storage = storage;
		this.nextVersion = 0;
		this.state = {};
		this.replaying = false;
		this.subs = [];
	}

	/**
	 * Unsubscribes this actor and prevents it from firing
	 * @access public
	 */
	Destroy() {
		this.subs.forEach( ( sub ) => {
			this.storage.Unsubscribe( sub[ 0 ], sub[ 1 ] );
		} );
	}

	/**
	 * Listen to the events from another id
	 * @access protected
	 * @param {string} id The id to listen to
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
	 * @returns {Promise.<object>}
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
	 * Loads the current state and subscribes to new events
	 * @access public
	 * @returns {Promise.<void>}
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
	 * @returns {Promise.<void>}
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
	 * Projects the state elsewhere
	 * @access protected
	 * @returns {Promise.<void>}
	 */
	async Project() {
	}

	/**
	 * resolves when all events have been stored
	 * @access public
	 * @returns {Promise.<Array|boolean>}
	 */
	async Store() {
		return await this.storage.Store( this, [], true );
	}

	/**
	 * Takes a snapshot of the current state
	 * @access protected
	 * @returns {Promise.<Object>}
	 */
	async Snapshot() {
		return this.state;
	}

	/**
	 * The id
	 * @access public
	 * @returns {string}
	 */
	Id() {
		return this.id;
	}

	/**
	 * Fires an event, resolves after the event has persisted and applied
	 * @access protected
	 * @param {string} name The name of the event
	 * @param {Object} data The data payload of the event
	 * @param {function|null} successCallback A callback to call if the fire was a success
	 * @returns {Promise.<void>}
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
	 * @returns {{id: Array, model_id: string, version: (number|*), type: string, name: *, data: *, stored: boolean, at: Date, fired_by: *}}
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

module.exports = Actor;