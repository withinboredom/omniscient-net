const Storage = require( './Storage' );
const r = require( 'rethinkdbdash' );

/**
 * *Warning* You probably don't need to use this directly
 *
 * This class supplies The RqlStorage with distributed locks.
 *
 * If you know a lot about this sort of thing ... please help out.
 *
 * @see {@link #RqlStorage}
 */
class RqlLockProvider {

	/**
	 * Create a lock provider
	 * @param {r} r A rethinkdb instance
	 */
	constructor( r ) {
		/**
		 * The rethinkdb instance
		 * @type {r}
		 */
		this.r = r;

		/**
		 * A map of locks
		 * @type {Map}
		 */
		this.locks = new Map();
	}

	/**
	 * Initialize the lock states, subscribes to updates
	 * @access public
	 * @return {Promise.<void>} A promise that resolves once everything is initialized
	 */
	async init() {
		const change = await this.r.table( 'locks' ).changes( { includeInitial: true } );

		change.each( ( err, lock ) => {
			if ( err ) {
				return;
			}

			if ( ! lock.state ) {
				let promise = null;
				let resolver = () => {
				};

				if ( this.locks.has( lock.new_val.id ) ) {
					const item = this.locks.get( lock.new_val.id );
					promise = item.promise;
					resolver = item.resolver;
				}
				else {
					promise = new Promise( ( resolve ) => {
						resolver = resolve;
					} )
				}

				if ( locks.new_val ) {
					this.locks.set( lock.new_val.id, {
						instance: lock.new_val.value,
						promise,
						resolver
					} );
				}
				else {
					const value = this.locks.get( lock.old_val.id );
					this.locks.delete( lock.old_val.id );
					value.resolver();
				}
			}
		} );
	}

	/**
	 * Checks to see if a lock exists for a given stream id
	 * @access public
	 * @param {string} id The id to check for
	 * @return {boolean} `true` if a lock exists, otherwise `false`
	 */
	has( id ) {
		return this.locks.has( id );
	}

	/**
	 * Sets an instance to be the lock holder for an id
	 * @access public
	 * @param {string} id The id to lock
	 * @param {Actor} value The actor holding the lock
	 */
	set( id, value ) {
		let resolver = () => {
		};
		const promise = new Promise( ( resolve ) => {
			resolver = resolve;
		} );

		this.locks.set( id, {
			instance: value.instanceId,
			promise,
			resolver
		} );
		this.r.table( 'locks' ).get( id ).replace( {
			id,
			value: value.instanceId
		} );
	}

	/**
	 * Get's a promise that resolves once the lock is released
	 * @access public
	 * @param {string} id The stream id to get the lock from
	 * @return {Promise.<void>} A promise that resolves once the lock is released
	 */
	get( id ) {
		return this.locks.get( id ).promise;
	}

	/**
	 * Releases a lock
	 * @access public
	 * @param {string} id The id of the lock to release
	 */
	delete( id ) {
		const value = this.locks.get( id );
		value.resolver();
		this.locks.delete( id );
		this.r.table( 'locks' ).get( id ).delete();
	}
}

/**
 * Storage Adapters provide the mechanism for Hard Locks
 * and distributed actors to function. There's two adapters provided,
 * this is for a rethinkdb backed storage adapter.
 *
 * It's recommended to review RethinkDb's clustering and scalability
 * documentation to get the most from it.
 *
 * ```js
 * const {RqlStorage} = require('omniscient-net');
 * const storage = new RqlStorage(host, db, port, options);
 * // must always be called to assert db sanity and wire up locks
 * await storage.doMigrations();
 * ```
 * @extends Storage
 * @see {@link #Storage}
 */
class RqlStorage extends Storage {
	/**
	 * Creates a storage adapter backed by rethinkdb
	 * @param {string} host The host to connect to
	 * @param {string} db The database to connect to
	 * @param {int} port The port to connect to
	 * @param {Object} options Extraneous options
	 * @param {number} options.optimizeAt When to optimize the event stream through memoization / snapshot {@link #RqlStorage#optimizeAt} default is 10
	 */
	constructor( host, db, port, options = {} ) {
		super();

		/**
		 * A map of instances to projectors
		 * @private
		 * @type {WeakMap}
		 */
		this.projectors = new WeakMap();

		/**
		 * A map of instances to snapshotters
		 * @private
		 * @type {WeakMap}
		 */
		this.snaps = new WeakMap();

		/**
		 * The number to optimize the event stream by
		 * @private
		 * @type {number}
		 * @default 10
		 */
		this.optimizeAt = options.optimizeAt || 10;

		/**
		 * List of active id subscriptions
		 * @private
		 * @type {{}}
		 */
		this.subs = {};

		/**
		 * List of active name subscriptions
		 * @private
		 * @type {{}}
		 */
		this.subR = {};

		/**
		 * The current db name
		 * @private
		 * @type {string}
		 */
		this.db = db;

		/**
		 * The db
		 * @private
		 * @type {r}
		 */
		this.r = r( {
			cursor: false,
			host,
			db,
			port
		} );

		/**
		 * Distributed lock mechanism
		 * @private
		 * @type {RqlLockProvider}
		 */
		this.idLocks = new RqlLockProvider( this.r );
	}

	/**
	 * Allows a storage adapter to perform any asynchronous setup,
	 * such as connecting to a database, creating tables, preparing queries, etc.
	 *
	 * It usually *must* be called before anything else.
	 * @access public
	 * @returns {Promise.<void>}
	 */
	async doMigrations() {
		let dbs = await this.r.dbList().run();
		dbs = dbs.filter( ( dbName ) => {
			return dbName == this.db;
		} );

		if ( dbs.length == 0 ) {
			await this.r.dbCreate( this.db ).run();
			await this.r.tableCreate( 'version' ).run();
			await this.r.table( 'version' ).wait();
			await this.r.table( 'version' ).insert( {
				id: 'db',
				value: 0
			} ).run();
		}

		let currentVersion = await this.r.table( 'version' ).get( 'db' ).run();
		if ( ! currentVersion ) {
			currentVersion = 0;
		}

		let lock = await this.r.table( 'version' ).insert( {
			id: 'update-lock'
		} );

		if ( lock.errors > 1 ) {
			return;
		}

		const expectedVersion = 3;

		switch ( currentVersion.value + 1 ) {
			case 1:
				await this.r.tableCreate( 'events' ).run();
				await this.r.tableCreate( 'snapshots' ).run();
				await this.r.table( 'events' ).indexCreate( 'model_id' ).run();
				await this.r.table( 'events' ).indexCreate( 'version' ).run();
			case 2:
				await this.r.tableCreate( 'locks' )
			case 3:
				await this.r.table( 'events' ).indexCreate( 'name' ).run();
		}

		if ( currentVersion.value != expectedVersion ) {
			this.r.table( 'version' ).update( {
				id: 'db',
				value: expectedVersion
			} ).run();
		}

		this.r.table( 'version' ).get( 'update-lock' ).delete();

		await this.idLocks.init();
	}

	/**
	 * Loads a snapshot from storage
	 * @access private
	 * @param {Actor} instance The instance to load a snapshot for
	 * @return {Promise.<Object>}
	 */
	LoadSnapshot( instance ) {
		return this.r.table( 'snapshots' )
		           .get( `${instance.constructor.name}_${instance.Id()}` );
	}

	/**
	 * Loads an event stream from storage
	 * @access private
	 * @param {string} id The id of the stream to load
	 * @param {int} from The version to start loading from
	 * @return {Promise.<Array>}
	 */
	LoadEvents( id, from = 0 - 1 ) {
		return this.r.table( 'events' )
		           .between( [ id, from ], [ id, this.r.maxval ], { leftBound: 'open', rightBound: 'closed' } )
		           .orderBy( { index: 'id' } );
	}

	/**
	 * Inject an event stream into storage
	 * @access private
	 * @param {string} id The id of the stream
	 * @param {Array} events The events to inject
	 * @return {Promise.<Array>}
	 */
	Inject( id, events ) {
		return Promise.all( events.map( async( event ) => {
			await this.r.table( 'events' ).get( event.id ).replace( event );
		} ) );
	}

	/**
	 * Give the storage adapter a chance to close any open connections
	 * @access public
	 */
	Close() {
		setTimeout( () => {
			this.r.getPoolMaster().drain();
		}, 500 );
	}

	/**
	 * Stores an event stream to the backing device.
	 * @access public
	 * @param {Actor} instance The actor instance we are storing
	 * @param {Array} events The events to store
	 * @param {boolean} ignoreConcurrencyError Whether to ignore a concurrency error
	 * @return {Promise.<Array|boolean>} Resolves to an array of stored events if successful, otherwise false unless `ignoreConcurrencyError` is true
	 */
	async Store( instance, events, ignoreConcurrencyError = false ) {
		let stored = [];
		const id = instance.Id();
		const snapshotId = `${instance.constructor.name}_${id}`;
		if ( this.IsLocked( instance ) ) {
			await this.WaitLock( instance );
		}

		let lastVersion = 0 - 1;
		await Promise.all( events
			.filter( ( event ) => {
				lastVersion = Math.max( lastVersion, event.version );
				return ! event.stored;
			} )
			.map( async( event ) => {
				event.stored = true;
				stored.push( event );
				const result = await this.r.table( 'events' ).insert( event );
				if ( result.errors > 0 ) {
					event.stored = false;
					if ( ! ignoreConcurrencyError ) {
						console.error( 'concurrency exception attempting to store: ', event );
						stored = false;
					}

					this.UnsetProjector( instance );
					this.UnsetSnapshot( instance );

					return false;
				}
			} ) );

		const projector = this.projectors.get( instance );
		if ( projector ) {
			projector();
		}

		if ( events.length > 0
		     && events[ events.length - 1 ].version % this.optimizeAt == 0
		     && events[ events.length - 1 ].version > 1 ) {
			const snap = this.snaps.get( instance );
			if ( snap ) {
				const snapshot = {
					id: snapshotId,
					state: await snap(),
					version: lastVersion
				};

				this.r.table( 'snapshots' )
				    .get( snapshotId )
				    .replace( snapshot );
			}
		}

		this.UnsetProjector( instance );
		this.UnsetSnapshot( instance );
		return stored;
	}

	/**
	 * Set a callback to be called when it's safe for the instance to project it's state
	 * @access public
	 * @param {Actor} instance The instance to set the projector
	 * @param {Actor~ProjectorCallback} callback The callback
	 */
	SetProjector( instance, callback ) {
		this.projectors.set( instance, callback );
	}

	/**
	 * Un-set the projector callback for an instance
	 * @access public
	 * @param {Actor} instance The instance to unset
	 */
	UnsetProjector( instance ) {
		this.projectors.delete( instance );
	}

	/**
	 * Set a callback that can take a snapshot of an Actor instance
	 * @access public
	 * @param {Actor} instance
	 * @param {Actor~SnapshotCallback} callback
	 */
	SetSnapshot( instance, callback ) {
		this.snaps.set( instance, callback );
	}

	/**
	 * Unset a snapshot callback for the given instance.
	 * @access public
	 * @param {Actor} instance
	 */
	UnsetSnapshot( instance ) {
		this.snaps.delete( instance );
	}

	/**
	 * Subscribe to an event stream.
	 * @access public
	 * @param {string} id The id of the stream to subscribe to
	 * @param {Actor~OnEvent} cb The function to call on new events
	 * @param {int} sinceVersion The version to start streaming from
	 * @return {Promise.<void>} Resolves once the subscription is setup
	 */
	SubscribeTo( id, cb, sinceVersion = 0 - 1 ) {
		if ( ! this.subs[ id ] ) {
			this.subs[ id ] = [];
		}

		const promise = this.r.table( 'events' )
		                    .between( [ id, sinceVersion ], [ id, this.r.maxval ] )
		                    .changes( { includeInitial: true, includeStates: true } )

		return promise.then( ( cursor ) => {
			const tie = [ cb, cursor ];
			this.subs[ id ].push( tie );
			let holder = false;

			let resolver;

			const promise = new Promise( ( resolve ) => {
				resolver = resolve;
			} );

			cursor.each( async( err, event ) => {
				if ( err ) {
					console.error( `Cursor unexpectedly closed for ${id}` );
					return;
				}

				if ( event.state && event.state == 'initializing' ) {
					holder = [];
					return;
				}

				if ( event.state && event.state == 'ready' ) {
					holder = holder.sort( ( left, right ) => {
						return left.new_val.version < right.new_val.version ? 0 - 1 : 1;
					} );

					await Promise.all( holder.map( async( event ) => {
						await cb( event.new_val );
					} ) );

					holder = null;

					resolver();

					return;
				}

				if ( holder ) {
					event.new_val.replay = true;
					holder.push( event );
					return;
				}

				event.new_val.live_replay = true;

				await cb( event.new_val );
			} );

			return promise;
		} );
	}

	/**
	 * Subscribe to future events of a given name. It returns a promise that
	 * resolves once the subscription is ready.
	 * @access public
	 * @param {string} name The name of events to listen to
	 * @param {Actor~OnEvent} cb A callback to call
	 * @returns {Promise.<void>} Resolves once the subscription is setup
	 */
	SubscribeToName( name, cb ) {
		if ( ! this.subR[ name ] ) {
			this.subR[ name ] = [];
		}

		const promise = this.r.table( 'events' )
		                    .getAll( name, { index: 'name' } )
		                    .changes( { includeInitial: false } )
		                    .run();
		return promise.then( ( cursor ) => {
			this.subR[ name ].push( [ cb, cursor ] );
			cursor.each( ( err, event ) => {
				if ( err ) {
					return;
				}
				cb( event.new_val );
			} );
		} )
	}

	/**
	 * Unsubscribe from a name/id. You must pass the original reference
	 * to the callback you'd like to unsubscribe from.
	 * @param {string} id The name/id to unsubscribe from
	 * @param {Actor~OnEvent} cb The callback of the subscription
	 */
	Unsubscribe( id, cb ) {
		if ( this.subs[ id ] ) {
			this.unsub( 'subs', id, cb );
			console.log( `Unsubscribed from ${id} -- ${this.subs[ id ] ? this.subs[ id ].length : 0} still attached` );
		}

		if ( this.subR[ id ] ) {
			this.unsub( 'subR', id, cb );
			console.log( `Unsubscribed from ${id} -- ${this.subR[ id ] ? this.subR[ id ].length : 0} still attached` );
		}
	}

	/**
	 * @private
	 */
	unsub( item, id, cb ) {
		this[ item ][ id ] = this[ item ][ id ]
			.filter( ( pair ) => {
				if ( pair[ 0 ] === cb ) {
					pair[ 1 ].close();
					return false;
				}
				return true;
			} )
	}
}

module.exports = RqlStorage;