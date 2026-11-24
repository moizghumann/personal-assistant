import { logger, task, wait } from '@trigger.dev/sdk'

export const helloWorld = task({
  id: 'hello-world',
  maxDuration: 60,
  run: async (payload: {name?: string}) => {
    logger.log("Hello World! Payload:", { payload });

    await wait.for({ seconds: 5 });

    return ({ message: `Hello, ${payload.name ?? "world"}` });
  },
})
