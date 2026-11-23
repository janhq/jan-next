/** API connection inputs shared by the Host and its clients. */

/** Whether a Peer participates in forwarded human interactions. */
export type ConnectionInteractions = 'answer' | 'none'

/** Whether a Peer's calls may reach other Hosts through the Gateway forwarder; `local` is for federating Hosts. */
export type ConnectionForward = 'all' | 'local'

/** Launch-token exchange route for API clients. */
export const CONNECT_PATH = '/connect'
