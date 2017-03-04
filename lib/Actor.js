const uuid = require( 'uuid/v4' );

class Actor {
	constructor( id, storage ) {
		this.id = id;
		this.instanceId = uuid();
		this.storage = storage;
		this.nextVersion = 0;
		this.state = {};
		this.replaying = false;
		this.subs = [];
	}

	Destroy() {
		this.subs.forEach( ( sub ) => {
			this.storage.Unsubscribe( sub[ 0 ], sub[ 1 ] );
		} );
	}

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

	async Load() {
		const latestSnapshot = await this.ApplySnapshot();

		const cb = async( event ) => await this.ApplyEvent( event, true );
		this.subs.push( [ this.Id(), cb ] );

		await this.storage.SubscribeTo( this.Id(), cb, latestSnapshot.version );
	}

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

	async Project() {
	}

	async Store() {
		return await this.storage.Store( this, [], true );
	}

	async Snapshot() {
		return this.state;
	}

	Id() {
		return this.id;
	}

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