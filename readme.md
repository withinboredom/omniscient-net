# Omniscient Net

A simple event based / actor model that pretty
much does what it wants.

## Requirements:
- node v7.7.1 or higher

## Optional requirements
- rethinkdb if you want to use rethinkdb storage driver

# About this library

Omniscient Net is an attempt to make distributed
 objects simple and event based.

For example, say we have an api, called the 
 "smart-api". We need to perform an action, have
 it only occur once, and store the result as
 part of the state.
 
It might look something like:

``` js
import { Actor } from 'omniscient-net';
import api from 'smart-api';

class SmartActor extends Actor {
    async DoSomething(smart) {
        const response = await api.get(smart);
        await this.Fire('did_smart_thing', response);
    }
    
    async did_smart_thing(data) {
        this.state.amSmart = data.isSmart;
    }
}
```

There's two functions to this class:
- DoSomething
- did_smart_thing

When you call DoSomething, it will perform a
side effect on the universe, and "fire" the
result. Every running instance of `SmartActor`
will instantly receive the result and update
it's internal state.

So, how to use `SmartActor`? Here's an example:

```js
import { RqlStorage } from 'omniscient-net';
import SmartActor from './SmartActor';

const storage = new RqlStorage('host', 'db', 'port');
const actor = new SmartActor('id', storage);
actor
    .Load()
    .then(() => actor.DoSomething('am i smart?'))
    .then(() => actor.Destroy());
```

Any running instance will automatically have
`did_smart_thing` called on it, as well as any
future instances with the same id, when `Load()`
is called.

Writing tests with jest (or jasmine) is incredibly simple:

```js
import {Given} from 'omniscient-net';
import SmartActor from './SmartActor';

describe('a smart actor', () => {
	it('figures out if its smart', async () => {
		const test = await Given(SmartActor, [])
		    .When('DoSomething', 'am i smart?')
		    .Then([
		    	{
		    		name: 'did_smart_thing',
		    		data: {
		    			isSmart: false
		    		}
		    	}
		    ]);
		await test.And({
			amSmart: false
		});
	});
});
```

This is simple event sourcing.

# API

## Memstorage

An in-memory storage adapter.

