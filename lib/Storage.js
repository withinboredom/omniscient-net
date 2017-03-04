/**
 * Base storage behavior
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
	 * Determines if an instance is locked
	 * @param {Actor} instance The instance to check
	 * @returns {boolean} Whether or not it is locked
	 */
	IsLocked( instance ) {
		return this.locks.has( instance ) || this.idLocks.has( instance.Id() );
	}

	/**
	 * Determines if an instance is hard locked
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
	 * Unlocks an instance
	 * @param {Actor} instance
	 */
	Unlock( instance ) {
		if ( this.locks.has( instance ) ) {
			this.locks.get( instance )( true );
		}
	}

	/**
	 * Locks an instance
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
	 * Hard Locks an instance
	 * @param {Actor} instance
	 */
	HardLock( instance ) {
		if ( ! this.IsLocked( instance ) ) {
			this.SoftLock( instance );
		}

		return this.locks.get( instance )( 1 );
	}

	WaitLock( instance ) {
		if ( instance.constructor.name === 'Promise' ) {
			return instance;
		}

		return this.locks.get( instance )();
	}
}

module.exports = Storage;