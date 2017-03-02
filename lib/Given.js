const Storage = require( './MemStorage' );
const Actor = require( './Actor' );

const id = '123456789';

Date = function () {
	return [ 'date' ]
};

function Given( story, object, events = [] ) {
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
			return new When( object, realEvents, action, parameters, story );
		}
	};
}

class When {
	constructor( model, previous, action, params, story ) {
		this.previous = previous;
		this.action = action;
		this.model = model;
		this.parameters = params;
		this.story = story;
	}

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

class And {
	constructor( test ) {
		this.test = test;
	}

	async And( expected ) {
		const snapshot = await this.test.Snapshot();
		expect( snapshot ).toEqual( expected );
	}
}

module.exports = Given;