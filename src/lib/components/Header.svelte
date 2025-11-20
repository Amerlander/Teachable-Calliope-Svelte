<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  $: active = $page.url.pathname.startsWith('/tryout') ? 'tryout' : 'training';
  function navTo(view: string) {
    goto(`/${view}`);
  }
</script>

<header id="main-header">
  <div class="header-inner">
    <div class="header-left">
      <!-- Original SVG from legacy -->
      <svg width="35px" height="35px" viewBox="0 0 27 26" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xml:space="preserve" style="fill-rule:evenodd;clip-rule:evenodd;stroke-linejoin:round;stroke-miterlimit:2;" class="logo-icon"><g transform="matrix(1,0,0,1,-168.819,-43.654)"><g transform="matrix(1,0,0,1,0,1)"><g transform="matrix(1,0,0,1,0,-1001.5)"><path d="M188.739,1046.34L193.961,1046.34L193.961,1052.77L188.739,1052.77L188.739,1046.34ZM182.705,1056.02L183.882,1052.23L185.841,1056.02L182.705,1056.02ZM179.473,1056.02L181.44,1052.26L182.609,1056.02L179.473,1056.02ZM180.501,1047.53L184.839,1047.53L184.839,1050.46C184.839,1051.41 184.072,1052.18 183.125,1052.18L182.215,1052.18C181.268,1052.18 180.501,1051.41 180.501,1050.46L180.501,1047.53ZM193.658,1044.68L189.041,1044.68C188.347,1044.68 187.784,1045.25 187.784,1045.94C187.784,1045.94 187.776,1049.88 187.776,1049.42C187.776,1046.52 185.42,1044.16 182.513,1044.16C179.606,1044.16 177.249,1046.52 177.249,1049.42L177.249,1055.21L171.006,1059.88C166.797,1063.1 169.069,1069.82 174.364,1069.82L175.618,1069.82C176.145,1065.94 177.356,1061.15 179.813,1058.25L185.528,1058.25C188.016,1061.19 189.074,1065.92 189.59,1069.82L191.358,1069.82C193.322,1069.82 194.915,1068.22 194.915,1066.26L194.915,1045.94C194.915,1045.25 194.353,1044.68 193.658,1044.68" style="fill:#ffffff;fill-rule:nonzero;"></path></g></g></g></svg>
      <span class="header-title">Calliope Teachable Machine</span>
    </div>

    <div class="header-right">
      <button class="header-btn" class:active={active === 'training'} on:click={() => navTo('training')}>Training/Test</button>
      <button class="header-btn" class:active={active === 'tryout'}  on:click={() => navTo('tryout')}>Ausprobieren</button>
    </div>
  </div>
</header>
