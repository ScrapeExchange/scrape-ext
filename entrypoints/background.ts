import { bootstrap } from '~/background/router';

export default defineBackground(() => {
  void bootstrap();
});
