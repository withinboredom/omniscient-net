# Using with jest

To get started, create a jest test and import your Actor class you'd like to test, as well as the `Given` function:

```js
import { MyActor } from '../MyActor';
import { Given } from 'omniscient-net';

describe('MyActor' () => {});
```

## Create a test

First, try and decide which event you want to test. Let's test that calling "DoLogin" will fire the "user logged in" event and it set the state correctly:

```js
import { MyActor } from '../MyActor';
import { Given } from 'omniscient-net';

describe('MyActor' () => {
  it('fires the login event', async() => {
    // give a class to instantiate and a list of previous events to apply
    const test = await Given( MyActor, [] )
    	// call the function 'DoLogin' with the singular parameter, 'password'
      .When( 'DoLogin', 'password' )
    	// assert that 'user logged in' event fires
    	.Then( [
      	{
          name: 'user logged in'
          data: {}
      	}
      ]);
    // assert the final state
    test.And({
      activeSessions: [{ ip: '127.0.0.1' }]
    });
  });
});
```