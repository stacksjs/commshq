import { Job } from '@stacksjs/queue'
import { abandonQuietCarts } from '../Support/commerceCarts'

/**
 * Every five minutes, mark the carts that have gone quiet without an order
 * as abandoned, and start the automations waiting for `cart_abandoned`.
 * The rules are in `app/Support/commerceCarts.ts`.
 */
export default new Job({
  name: 'AbandonQuietCarts',
  description: 'Marks quiet carts abandoned and starts cart automations',
  queue: 'scheduler',
  tries: 1,

  async handle() {
    return await abandonQuietCarts()
  },
})
