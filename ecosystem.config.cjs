module.exports = {
  apps: [{
    name: 'sonos-controller',
    script: 'npm',
    args: 'run dev',
    cwd: __dirname, // automatically resolves to this file's directory
    watch: false,
    autorestart: true,
    env: {
      NODE_ENV: 'development'
    }
  }]
}
