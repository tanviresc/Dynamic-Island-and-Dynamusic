export interface MotionPresets {
  appear: {
    layout: { type: "spring"; stiffness: number; damping: number; mass: number };
    content: { opacity: { duration: number; delay: number; ease: string }; filter?: { duration: number; delay: number } };
  };
  disappear: {
    layout: { type: "spring"; stiffness: number; damping: number; mass: number; delay: number };
    content: { opacity: { duration: number; ease: string } };
  };
  contentChange: {
    layout: { type: "spring"; stiffness: number; damping: number };
    crossfade: { duration: number };
  };
  queueOpen: {
    layout: { type: "spring"; stiffness: number; damping: number; mass: number };
    stagger: number;
    rowDuration: number;
    rowDelay: number;
  };
  queueClose: {
    layout: { type: "spring"; stiffness: number; damping: number };
    rowDuration: number;
  };
  dotAppear: {
    scale: { type: "spring"; stiffness: number; damping: number };
    opacity: { duration: number };
  };
  dotDisappear: {
    duration: number;
    ease: string;
  };
  dotColor: {
    duration: number;
    ease: string;
  };
}

export const standardMotion: MotionPresets = {
  appear: {
    layout: { type: "spring", stiffness: 150, damping: 20, mass: 1.1 },
    content: {
      opacity: { duration: 0.35, delay: 0.18, ease: "easeOut" },
      filter: { duration: 0.35, delay: 0.18 },
    },
  },
  disappear: {
    layout: { type: "spring", stiffness: 160, damping: 22, mass: 1.0, delay: 0.05 },
    content: {
      opacity: { duration: 0.20, ease: "easeInOut" },
    },
  },
  contentChange: {
    layout: { type: "spring", stiffness: 160, damping: 22 },
    crossfade: { duration: 0.25 },
  },
  queueOpen: {
    layout: { type: "spring", stiffness: 150, damping: 20, mass: 1.1 },
    stagger: 0.04,
    rowDuration: 0.30,
    rowDelay: 0.15,
  },
  queueClose: {
    layout: { type: "spring", stiffness: 170, damping: 22 },
    rowDuration: 0.15,
  },
  dotAppear: {
    scale: { type: "spring", stiffness: 180, damping: 18 },
    opacity: { duration: 0.35 },
  },
  dotDisappear: {
    duration: 0.30,
    ease: "easeInOut",
  },
  dotColor: {
    duration: 0.40,
    ease: "easeInOut",
  },
};

export const reducedMotion: MotionPresets = {
  appear: {
    layout: { type: "spring", stiffness: 10000, damping: 1000, mass: 0.1 },
    content: {
      opacity: { duration: 0.12, delay: 0, ease: "linear" },
    },
  },
  disappear: {
    layout: { type: "spring", stiffness: 10000, damping: 1000, mass: 0.1, delay: 0 },
    content: {
      opacity: { duration: 0.12, ease: "linear" },
    },
  },
  contentChange: {
    layout: { type: "spring", stiffness: 10000, damping: 1000 },
    crossfade: { duration: 0.12 },
  },
  queueOpen: {
    layout: { type: "spring", stiffness: 10000, damping: 1000, mass: 0.1 },
    stagger: 0,
    rowDuration: 0.12,
    rowDelay: 0,
  },
  queueClose: {
    layout: { type: "spring", stiffness: 10000, damping: 1000 },
    rowDuration: 0.12,
  },
  dotAppear: {
    scale: { type: "spring", stiffness: 10000, damping: 1000 },
    opacity: { duration: 0.12 },
  },
  dotDisappear: {
    duration: 0.12,
    ease: "linear",
  },
  dotColor: {
    duration: 0.12,
    ease: "linear",
  },
};
