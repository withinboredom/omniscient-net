const Storage = require( './MemStorage' );
const Actor = require( './Actor' );

const id = '123456789';

Date = function () {
	return [ 'date' ]
};

/**
 * Given an object and a set of events
 * @param {Actor.constructor} object The class to give
 * @param {Array} events The events to give
 * @return {When}
 */
function Given( object, events = [] ) {
	let version = 0;
	const realEvents = [];
	events.forEach( ( event ) => {
		realEvents.push( {
			model_id: id,
			version: version ++,
			name: event.name,
			data: event.data,
			stored: true,
			fired_by: 'manual',
			at: new Date()
		} );
	} );

	return {
		When: ( action, ...parameters ) => {
			return new When( object, realEvents, action, parameters );
		}
	};
}

/**
 * Handles The next step to Given
 * @see {@link #Given}
 */
class When {
	constructor( model, previous, action, params ) {
		this.previous = previous;
		this.action = action;
		this.model = model;
		this.parameters = params;
	}

	/**
	 * Then it expects these events will fire
	 * @see {@link #Given}
	 * @access public
	 * @param {Array} expected An array of expected events
	 * @return {Promise.<And>}
	 */
	async Then( expected ) {
		const storage = new Storage();
		const model = this.model;
		const underTest = new model( id, storage );
		storage.Inject( id, this.previous );
		const action = this.action;

		await underTest.Load();
		await underTest[ action ]( ...this.parameters );

		const results = await underTest.Store();

		expect( results
			.filter( ( event ) => event.new )
			.map( ( event ) => {
				return {
					name: event.name,
					data: event.data
				};
			} ) ).toEqual( expected );

		return new And( underTest );
	}
}

/**
 * Verifies State
 * @see {@link #Given}
 */
class And {
	constructor( test ) {
		this.test = test;
	}

	/**
	 * And this state
	 * @access public
	 * @param {Object} expected The expected state
	 * @return {Promise.<void>}
	 */
	async And( expected ) {
		const snapshot = await this.test.Snapshot();
		expect( snapshot ).toEqual( expected );
	}
}

module.exports = Given;