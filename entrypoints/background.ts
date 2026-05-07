import { bootstrap } from '../src/background/router';

export default defineBackground(() => {
  void bootstrap();
});
