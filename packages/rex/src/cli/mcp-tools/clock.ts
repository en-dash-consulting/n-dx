/** The clock a v2 write tool reads inside the PRD lock; tests inject one. */
export type Clock = () => Date;

export const systemClock: Clock = () => new Date();
