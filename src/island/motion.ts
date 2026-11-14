export interface MotionPresets {
  appear: {
    layout: { duration?: number; ease?: string | number[]; type?: string; stiffness?: number; damping?: number; mass?: number };
    content: { opacity: { duration: number; delay: number; ease: string }; filter?: { duration: number; delay: number } };
  };
  disappear: {
    layout: { duration?: number; ease?: string | number[]; type?: string; stiffness?: number; damping?: number; mass?: number; delay?: number };
    content: { opacity: { duration: number; ease: string } };
  };
  contentChange: {
    layout: { type?: string; stiffness?: number; damping?: number; mass?: number; duration?: number; ease?: string | number[] };
    crossfade: { duration: number };
  };
  queueOpen: {
    layout: { type?: string; stiffness?: number; damping?: number; mass?: number; duration?: number; ease?: string | number[] };
    stagger: number;
    rowDuration: number;
    rowDelay: number;
  };
  queueClose: {
    layout: { type?: string; stiffness?: number; damping?: number; mass?: number; duration?: number; ease?: string | number[] };
    rowDuration: number;
  };
  dotAppear: {
    scale: { type?: string; stiffness?: number; damping?: number };
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
    layout: { type: "spring", stiffness: 420, damping: 32, mass: 0.8 },
    content: {
      opacity: { duration: 0.18, delay: 0.04, ease: "easeOut" },
    },
  },
  disappear: {
    layout: { type: "spring", stiffness: 480, damping: 36, mass: 0.7 },
    content: {
      opacity: { duration: 0.14, ease: "easeInOut" },
    },
  },
  contentChange: {
    layout: { type: "spring", stiffness: 420, damping: 32, duration: 0.25 },
    crossfade: { duration: 0.18 },
  },
  queueOpen: {
    layout: { type: "spring", stiffness: 400, damping: 30, mass: 0.85 },
    stagger: 0.025,
    rowDuration: 0.18,
    rowDelay: 0.04,
  },
  queueClose: {
    layout: { type: "spring", stiffness: 460, damping: 34, mass: 0.75 },
    rowDuration: 0.12,
  },
  dotAppear: {
    scale: { type: "spring", stiffness: 420, damping: 24 },
    opacity: { duration: 0.18 },
  },
  dotDisappear: {
    duration: 0.16,
    ease: "easeInOut",
  },
  dotColor: {
    duration: 0.25,
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
