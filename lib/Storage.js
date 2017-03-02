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
		return this.locks.has( instance );
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
		let locked = true;
		let resolver = () => {
		};

		const lockP = new Promise( ( resolve ) => {
			resolver = resolve;
		} );

		this.locks.set( instance, ( unlock ) => {
			if ( unlock === 1 ) {
				return locked = 1;
			}

			if ( unlock === false ) {
				return locked === 1;
			}

			if ( unlock === true ) {
				this.locks.delete( instance );
				return resolver( true );
			}

			return lockP;
		} );
	}

	/**
	 * Hard Locks an instance
	 * @param {Actor} instance
	 */
	HardLock( instance ) {
		if ( ! this.IsLocked( instance ) ) {
			this.SoftLock( instance );
		}

		this.locks.get( instance )( 1 );
	}
}

module.exports = Storage;