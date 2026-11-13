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
    layout: { type: "spring", stiffness: 380, damping: 30, mass: 0.9 },
    content: {
      opacity: { duration: 0.16, delay: 0.09, ease: "easeOut" },
      filter: { duration: 0.16, delay: 0.09 },
    },
  },
  disappear: {
    layout: { type: "spring", stiffness: 520, damping: 42, mass: 0.9, delay: 0.06 },
    content: {
      opacity: { duration: 0.10, ease: "easeIn" },
    },
  },
  contentChange: {
    layout: { type: "spring", stiffness: 420, damping: 34 },
    crossfade: { duration: 0.12 },
  },
  queueOpen: {
    layout: { type: "spring", stiffness: 300, damping: 28, mass: 1 },
    stagger: 0.025,
    rowDuration: 0.18,
    rowDelay: 0.12,
  },
  queueClose: {
    layout: { type: "spring", stiffness: 520, damping: 44 },
    rowDuration: 0.08,
  },
  dotAppear: {
    scale: { type: "spring", stiffness: 600, damping: 30 },
    opacity: { duration: 0.12 },
  },
  dotDisappear: {
    duration: 0.14,
    ease: "easeIn",
  },
  dotColor: {
    duration: 0.20,
    ease: "easeOut",
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
