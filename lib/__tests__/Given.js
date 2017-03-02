const Actor = require( '../Actor' );
const Given = require( '../Given' );

class Test extends Actor {
	constructor( id, storage ) {
		super( id, storage );

		this.state.counter = 0;
		this.state.test = false;
	}

	test() {
		this.state.counter += 1;
		this.state.test = true;
	}

	async DoTest() {
		await this.Fire( 'test', {} );
	}
}

describe( 'Given', () => {
	it( 'a simple test', async() => {
		const test = await Given( 'a simple test', Test, [] ).When( 'DoTest' ).Then( [
			{
				name: 'test',
				data: {}
			}
		] );
		test.And( {
			counter: 1,
			test: true
		} );
	} );
	it( 'can handle previous events', async() => {
		const test = await Given( 'a simple test', Test, [
			{
				name: 'test',
				data: {}
			}
		] ).When( 'DoTest' ).Then( [
			{
				name: 'test',
				data: {}
			}
		] );
		test.And( {
			counter: 2,
			test: true
		} );
	} )
} );