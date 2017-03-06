const Storage = require( './Storage' );
const r = require( 'rethinkdbdash' );

class LockProvider {
	constructor( r ) {
		this.r = r;
		this.locks = new Map();
	}

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

	has( id ) {
		const has = this.locks.has( id );
		return has;
	}

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

	get( id ) {
		return this.locks.get( id ).promise;
	}

	delete( id ) {
		const value = this.locks.get( id );
		value.resolver();
		this.locks.delete( id );
		this.r.table( 'locks' ).get( id ).delete();
	}
}

/**
 * A storage adapter backed by rethinkdb
 */
class RqlStorage extends Storage {
	/**
	 * Creates a storage adapter backed by rethinkdb
	 * @param {string} host The host to connect to
	 * @param {string} db The database to connect to
	 * @param {int} port The port to connect to
	 * @param {{optimizeAt: int}} options Extraneous options
	 */
	constructor( host, db, port, options = {} ) {
		super();

		this.projectors = new WeakMap();
		this.snaps = new WeakMap();
		this.optimizeAt = options.optimizeAt || 10;

		this.subs = {};
		this.subR = {};

		this.db = db;

		this.r = r( {
			cursor: false,
			host,
			db,
			port
		} );

		this.idLocks = new LockProvider( this.r );
	}

	/**
	 * Performs migrations
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
	 * @return {Promise.<*>}
	 */
	Inject( id, events ) {
		return Promise.all( events.map( async( event ) => {
			await this.r.table( 'events' ).get( event.id ).replace( event );
		} ) );
	}

	/**
	 * Close any connections
	 * @access public
	 */
	Close() {
		setTimeout( () => {
			this.r.getPoolMaster().drain();
		}, 500 );
	}

	/**
	 * Stores raw events to the event stream
	 * @access public
	 * @param {Actor} instance The actor instance we are storing
	 * @param {Array} events The events to store
	 * @param {boolean} ignoreConcurrencyError Whether to ignore a concurrency error
	 * @return {Promise.<Array|boolean>}
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
	 * Set the projector for a given instance
	 * @access public
	 * @param {Actor} instance The instance to set the projector
	 * @param {function} callback The callback
	 */
	SetProjector( instance, callback ) {
		this.projectors.set( instance, callback );
	}

	/**
	 * Un-set the projector callback
	 * @access public
	 * @param {Actor} instance The instance to unset
	 */
	UnsetProjector( instance ) {
		this.projectors.delete( instance );
	}

	/**
	 * Set the snapshot callback
	 * @access public
	 * @param {Actor} instance
	 * @param {function} callback
	 */
	SetSnapshot( instance, callback ) {
		this.snaps.set( instance, callback );
	}

	/**
	 * Unset an instance snapshot callback
	 * @access public
	 * @param {Actor} instance
	 */
	UnsetSnapshot( instance ) {
		this.snaps.delete( instance );
	}

	/**
	 * Subscribe to an event stream
	 * @access public
	 * @param {string} id The id of the stream to subscribe to
	 * @param {function} cb The function to call on new events
	 * @param {int} sinceVersion The version to start streaming from
	 * @return {Promise.<void>}
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
	 * Subscribe to all future events of a given name
	 * @access public
	 * @param {string} name The name of events to listen to
	 * @param {function} cb A callback to call
	 * @returns {Promise.<void>}
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
	 * Unsubscribe
	 * @param {string} id The name/id to unsubscribe from
	 * @param {function} cb The callback of the subscription
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