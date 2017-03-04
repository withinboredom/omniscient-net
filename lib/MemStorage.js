const Storage = require( './Storage' );

/**
 * A solid in-memory storage provider,
 * mostly designed for testing
 * @augments Storage
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
		this.idLocks = new Map();
	}

	/**
	 * Injects an event into history -- only use for testing/mocking
	 * @param {string} id The id of the event
	 * @param {object} data The data of the event
	 */
	Inject( id, data ) {
		this.events[ id ] = data;
	}

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

	LoadSnapshot( id ) {
		return Promise.resolve( null );
	}

	LoadEvents( id, from = 0 - 1 ) {
		if ( this.events[ id ] ) {
			return Promise.resolve( this.events[ id ].filter( ( event ) => event.version > from ) );
		}

		return Promise.resolve( [] );
	}

	SubscribeTo( id, cb ) {
		if ( ! this.subs[ id ] ) {
			this.subs[ id ] = [];
		}

		this.subs[ id ].push( cb );

		if ( this.events[ id ] ) {
			this.events[ id ].forEach( async( event ) => {
				event.replay = true;
				await cb( event );
				event.replay = undefined;
			} );
		}
	}

	Unsubscribe( id, cb ) {
		if ( this.subs[ id ] ) {
			this.subs[ id ] = this.subs[ id ].filter( ( sub ) => sub !== cb );
		}
	}

	SetProjector( instance ) {
	}

	UnsetProjector( instance ) {
	}

	SetSnapshot( instance ) {
	}

	UnsetSnapshot( instance ) {
	}
}

module.exports = MemStorage;