/**
 * All storage adapters extend the `Storage` class. The base class manages
 * locks: Soft Locks and Hard Locks.
 *
 * Locks give your application an ability to handle transactions, by
 * preventing mutation of state, either per instance or per stream id.
 *
 * ## What's a Soft Lock?
 *
 * A Soft Lock prevents an instance from persisting events, but still
 * allows events to be applied to the current instance. An example:
 *
 * **warning!** These examples are flawed and will cause issues. Do not
 * use until it can be fixed in a future release
 *
 * ```js
 * async function() {
 * const actor = new Actor(id, storage);
 *  await actor.Load()
 *  // attempt to get a soft lock
 *  if (storage.SoftLock(actor)) {
 *    // we have the lock, so try to do something complex
 *    try {
 *      await actor.ComplexTask();
 *      storage.Unlock(actor);
 *    }
 *    catch (err) {
 *      // do something
 *    }
 *    finally() {
 *      // don't unlock
 *      actor.Destroy();
 *    }
 *  }
 * }
 * ```
 *
 * ## What's a Hard Lock?
 *
 * A hard lock is very different from a soft lock. A soft lock is per
 * instance. Meaning multiple instances of an actor id can hold a soft
 * lock. A hard lock is a distributed lock. No other instances will be
 * able to take a lock, or persist events, including the locked instance,
 * until the lock is released.
 *
 * ```js
 * async function() {
 *   const actor = new Actor(id, storage);
 *   await actor.Load();
 *   // make sure we can get a soft lock
 *   if (storage.SoftLock(actor)) {
 *     // make sure we can get a hard lock
 *     if (storage.HardLock(actor)) {
 *       try {
 *         await actor.ComplexTask();
 *         storage.Unlock(actor);
 *       }
 *       catch(err) {
 *         // do something
 *       }
 *       finally() {
 *         actor.Destroy();
 *       }
 *     }
 *   }
 * }
 * ```
 */
class Storage {
	/**
	 * Creates a storage object
	 * @constructor
	 */
	constructor() {
		this.locks = new WeakMap();
	}

	/**
	 * Will return true whether the lock is a hard lock or a soft lock.
	 * @param {Actor} instance The instance to check
	 * @returns {boolean} Whether or not it is locked
	 */
	IsLocked( instance ) {
		return this.locks.has( instance ) || this.idLocks.has( instance.Id() );
	}

	/**
	 * Returns `true` if an instance is hard locked
	 * @param {Actor} instance
	 * @returns {boolean} Whether or not it is hard locked
	 */
	IsHardLocked( instance ) {
		if ( ! this.IsLocked( instance ) ) {
			return false;
		}
		return this.locks.get( instance )( false );
	}

	/**
	 * Completely unlocks an instance. If some other instance
	 * locked it, you can call `Unlock` to force it.
	 * @param {Actor} instance
	 */
	Unlock( instance ) {
		if ( this.locks.has( instance ) ) {
			this.locks.get( instance )( true );
		}
	}

	/**
	 * Attempts to soft lock an instance, returns true if it was successful
	 * @param {Actor} instance
	 */
	SoftLock( instance ) {
		if ( this.IsLocked( instance ) ) {
			return false;
		}

		let locked = true;
		let resolver = () => {
		};

		const lockP = new Promise( ( resolve ) => {
			resolver = resolve;
		} );

		this.locks.set( instance, ( unlock ) => {
			if ( unlock === 1 ) {
				if ( locked === 1 ) {
					return false;
				}
				locked = 1;
				if ( this.idLocks.has( instance.Id() ) ) {
					this
						.WaitLock( this.idLocks.get( instance.Id() ) )
						.then( () => {
							this.Unlock( instance );
							resolver();
						} );
					return false;
				}
				this.idLocks.set( instance.Id(), instance );
				return true;
			}

			if ( unlock === false ) {
				return locked === 1;
			}

			if ( unlock === true ) {
				this.locks.delete( instance );
				if ( this.idLocks.has( instance.Id() ) ) {
					this.idLocks.delete( instance.Id() );
				}
				return resolver( true );
			}

			return lockP;
		} );

		return true;
	}

	/**
	 * Attempt to hard lock an instance, returns true if successful
	 * @param {Actor} instance
	 */
	HardLock( instance ) {
		if ( ! this.IsLocked( instance ) ) {
			this.SoftLock( instance );
		}

		return this.locks.get( instance )( 1 );
	}

	/**
	 * Returns a promise that resolves when the lock is released. If there's a hard lock,
	 * it will be resolved when the instance holding the lock releases the lock.
	 * @param {Actor} instance The instance to wait on
	 * @return {Promise.<void>}
	 */
	WaitLock( instance ) {
		if ( instance.constructor.name === 'Promise' ) {
			return instance;
		}

		return this.locks.get( instance )();
	}
}

module.exports = Storage;