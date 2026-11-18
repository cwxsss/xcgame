// Every release includes its images in the UI container, served by nginx.
function imageGenerator() {
  return {
    filename: 'img/[name].[contenthash:16][ext]',
    publicPath: process.env.VUE_APP_HALL_BASE === '/avalon/' ? '/avalon/' : '/',
  };
}

module.exports = { imageGenerator };
