const Storage = require( './Storage' );

/**
 * A solid in-memory storage provider,
 * mostly designed for testing
 * @extends Storage
 */
class MemStorage extends Storage {
	/**
	 * Creates a basic in-memory storage device
	 * @constructor
	 */
	constructor() {
		super();
		this.events = {};
		this.subs = {};
		this.names = {};
		this.idLocks = new Map();
	}

	/**
	 * Does nothing
	 */
	doMigrations() {
	}

	/**
	 * Injects an event into history -- only use for testing/mocking
	 * @param {string} id The id of the event
	 * @param {object} data The data of the event
	 */
	Inject( id, data ) {
		this.events[ id ] = data;
	}

	/**
	 * Does nothing
	 */
	Close() {
		// todo: kill all subs
	}

	/**
	 * Stores events for a given actor
	 * @param {Actor} instance
	 * @param {Array} events
	 * @param {boolean} ignoreConcurrencyError
	 * @returns {Promise.<Array>}
	 */
	async Store( instance, events, ignoreConcurrencyError = true ) {
		const id = instance.Id();
		const snapshotId = instance.constructor.name;

		if ( this.IsLocked( instance ) ) {
			await this.WaitLock( instance );
		}

		if ( this.events[ id ] === undefined ) {
			this.events[ id ] = [];
		}

		events
			.filter( ( event ) => ! event.stored )
			.forEach( ( event ) => {
				event.stored = true;
				event.new = true;
				this.events[ id ].push( event );
				if ( this.subs[ id ] ) {
					this.subs[ id ].forEach( ( cb ) => {
						cb( event );
					} );
				}
				if ( this.names[ event.name ] ) {
					this.names[ event.name ].forEach( ( cb ) => {
						cb( event );
					} );
				}
			} );

		return this.events[ id ]
			.filter( ( event ) => event.new )
			.sort( ( left, right ) => {
				if ( left.version < right.version ) {
					return 0 - 1;
				}

				return 1;
			} );
	}

	/**
	 * Returns a promise that immediately resolves
	 * @param {string} id
	 * @return {Promise.<null>}
	 */
	LoadSnapshot( id ) {
		return Promise.resolve( null );
	}

	/**
	 * Loads events
	 * @param {string} id
	 * @param {int} from default -1
	 * @return {Array}
	 */
	LoadEvents( id, from = 0 - 1 ) {
		if ( this.events[ id ] ) {
			return Promise.resolve( this.events[ id ].filter( ( event ) => event.version > from ) );
		}

		return Promise.resolve( [] );
	}

	/**
	 * Subscribe
	 * @param {string} id The id
	 * @param {Actor~OnEvent} cb Event handler
	 * @return {Promise.<void>}
	 */
	SubscribeTo( id, cb ) {
		if ( ! this.subs[ id ] ) {
			this.subs[ id ] = [];
		}

		this.subs[ id ].push( cb );

		if ( this.events[ id ] ) {
			return Promise.all( this.events[ id ].map( async( event ) => {
				event.replay = true;
				await cb( event );
				event.replay = undefined;
			} ) );
		}
	}

	/**
	 * Subscribe to a name
	 * @param {string} name
	 * @param {Actor~OnEvent} cb
	 */
	SubscribeToName( name, cb ) {
		if ( ! this.names[ name ] ) {
			this.names[ name ] = [];
		}

		this.names[ name ].push( cb );
	}

	/**
	 * Unsubscribe
	 * @param {string} id
	 * @param {Actor~OnEvent} cb
	 */
	Unsubscribe( id, cb ) {
		if ( this.subs[ id ] ) {
			this.subs[ id ] = this.subs[ id ].filter( ( sub ) => sub !== cb );
		}

		if ( this.names[ id ] ) {
			this.names[ id ] = this.names[ id ].filter( ( sub ) => sub !== cb );
		}
	}

	/**
	 * Does nothing
	 * @param {Actor} instance
	 */
	SetProjector( instance ) {
	}

	/**
	 * Does nothing
	 * @param {Actor} instance
	 */
	UnsetProjector( instance ) {
	}

	/**
	 * Does nothing
	 * @param {Actor} instance
	 */
	SetSnapshot( instance ) {
	}

	/**
	 * Does nothing
	 * @param {Actor} instance
	 */
	UnsetSnapshot( instance ) {
	}
}

module.exports = MemStorage;