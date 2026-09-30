<!--
 Elapsed-time tick labels on the BOTTOM axis of every Open MCT plot (added
 for the Open MCT / BOM project, used by XAxis.vue). They show time since data
 flow began (m:ss or h:mm:ss) from the shared data clock
 (src/plugins/dataSource/dataClock.js); Clear Data resets zero. UTC ticks are
 across the top of the plot (MctPlot.vue).
-->
<template>
  <div
    ref="axis"
    class="c-plot-elapsed-axis"
    :style="rootStyle"
    title="Time since data flow began (resets with Clear Data)"
    aria-label="Elapsed time axis"
  >
    <div v-if="!ticks.length" :style="emptyStyle">Waiting for data</div>
    <div v-for="tick in ticks" :key="tick.value" :style="tickStyle(tick)">
      {{ tick.text }}
    </div>
  </div>
</template>

<script>
import dataClock, { formatElapsed } from '../../dataSource/dataClock.js';
import configStore from '../configuration/ConfigStore.js';
import eventHelpers from '../lib/eventHelpers.js';

// Tick spacing options, in seconds. The smallest one that fits is used.
const STEPS_S = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600];
const MIN_LABEL_SPACING_PX = 70;
const MAX_TICKS = 100;

export default {
  inject: ['openmct', 'domainObject'],
  props: {
    height: {
      type: Number,
      default: 18
    }
  },
  data() {
    return {
      ticks: []
    };
  },
  computed: {
    rootStyle() {
      return {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: `${this.height}px`,
        overflow: 'hidden',
        fontSize: '0.7rem',
        lineHeight: `${this.height}px`,
        pointerEvents: 'none'
      };
    },
    emptyStyle() {
      return {
        position: 'absolute',
        left: '50%',
        transform: 'translateX(-50%)',
        opacity: 0.5,
        whiteSpace: 'nowrap'
      };
    }
  },
  mounted() {
    eventHelpers.extend(this);
    const config = configStore.get(this.openmct.objects.makeKeyString(this.domainObject.identifier));
    this.xAxis = config && config.xAxis;
    if (this.xAxis) {
      this.listenTo(this.xAxis, 'change:displayRange', this.update, this);
    }
    this.stopClock = dataClock.onChange(this.update);
    this.resizeObserver = new ResizeObserver(() => this.update());
    this.resizeObserver.observe(this.$refs.axis);
    this.update();
  },
  beforeUnmount() {
    this.stopListening();
    this.stopClock();
    this.resizeObserver.disconnect();
  },
  methods: {
    tickStyle(tick) {
      return {
        position: 'absolute',
        left: `${tick.left}%`,
        transform: 'translateX(-50%)',
        whiteSpace: 'nowrap'
      };
    },
    update() {
      const range = this.xAxis && this.xAxis.get('displayRange');
      const start = dataClock.start;
      const width = this.$refs.axis ? this.$refs.axis.offsetWidth : 0;
      if (!range || start === null || !width || !(range.max > range.min)) {
        this.ticks = [];
        return;
      }

      const spanS = (range.max - range.min) / 1000;
      const maxTicks = Math.max(1, Math.floor(width / MIN_LABEL_SPACING_PX));
      const step =
        STEPS_S.find((s) => spanS / s <= maxTicks) ||
        Math.ceil(spanS / maxTicks / 3600) * 3600;

      // Ticks sit on whole multiples of the step counted from zero.
      const ticks = [];
      let elapsedS = Math.ceil((range.min - start) / 1000 / step) * step;
      while (start + elapsedS * 1000 <= range.max && ticks.length < MAX_TICKS) {
        const t = start + elapsedS * 1000;
        ticks.push({
          value: elapsedS,
          left: ((t - range.min) / (range.max - range.min)) * 100,
          text: formatElapsed(elapsedS * 1000)
        });
        elapsedS += step;
      }
      this.ticks = ticks;
    }
  }
};
</script>
