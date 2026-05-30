import { closeDatabasePool } from '../backend/db/client';
import { runInitialRestaurantPosMigration } from '../backend/db/migrations';

runInitialRestaurantPosMigration()
  .then(async () => {
    await closeDatabasePool();
    console.log('RestaurantPOS database migrations completed.');
  })
  .catch(async (error) => {
    console.error(error);
    await closeDatabasePool();
    process.exitCode = 1;
  });
