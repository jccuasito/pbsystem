// Creates a separate local schema only. Does not reconfigure the ordinary app.
import { createFixture } from './helpers/scale-fixture.mjs'
await createFixture({ profile: 'million' })
