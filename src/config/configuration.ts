export default () => ({
    port: parseInt(process.env.PORT, 10) || 3000,
    nodeEnv: process.env.NODE_ENV || 'development',
    cors: process.env.CORS_ORIGIN || '*',
    apiKey: process.env.API_KEY || '6pfrn00011248xivxkz0t',
    database: {
      url: process.env.DATABASE_URL || 'postgresql://wallet_user:wallet_password@localhost:5432/wallet_system',
    },
    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT, 10) || 6379,
    },
    queue: {
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT, 10) || 6379,
      },
    },
  });