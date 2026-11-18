export const backendPort = Number(process.env.PORT ?? 3000);

// Local development accepts the frontend on any loopback port.
export const frontendOrigin =
  process.env.NODE_ENV === 'production'
    ? process.env.AVALON_FRONTEND_ORIGIN || false
    : /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
