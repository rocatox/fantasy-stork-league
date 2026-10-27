export class SessionError extends Error {constructor(public code:string, message:string){super(message);this.name='SessionError';}}
