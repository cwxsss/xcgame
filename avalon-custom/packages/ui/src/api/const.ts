const embeddedInHall = process.env.VUE_APP_HALL_BASE === '/avalon/';
export const socketURL = embeddedInHall || process.env.NODE_ENV === 'production' ? '/' : 'http://localhost:3000';
export const socketPath = embeddedInHall ? '/avalon/socket.io/' : '/socket.io/';
