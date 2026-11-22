import { motion } from 'framer-motion';
import { Sunrise, Sun, Sunset, Moon, Sparkles } from 'lucide-react';

// 1. Morning Icon (Sun rising with subtle bounce)
export const MotionMorning = ({ active }) => (
  <motion.div
    animate={active ? { y: [0, -3, 0], scale: [1, 1.05, 1] } : {}}
    transition={{ repeat: Infinity, duration: 3, ease: "easeInOut" }}
    whileHover={{ scale: 1.15, rotate: 15 }}
    className="text-amber-400"
  >
    <Sunrise className="w-5 h-5 drop-shadow-[0_0_8px_rgba(251,191,36,0.5)]" />
  </motion.div>
);

// 2. Day Icon (Rotating Sun rays)
export const MotionDay = ({ active }) => (
  <motion.div
    animate={active ? { rotate: 360 } : {}}
    transition={{ repeat: Infinity, duration: 12, ease: "linear" }}
    whileHover={{ scale: 1.2 }}
    className="text-orange-400"
  >
    <Sun className="w-5 h-5 drop-shadow-[0_0_10px_rgba(249,115,22,0.6)]" />
  </motion.div>
);

// 3. Evening Icon (Sun sinking + glowing horizon)
export const MotionEvening = ({ active }) => (
  <motion.div
    animate={active ? { opacity: [0.8, 1, 0.8], y: [0, 2, 0] } : {}}
    transition={{ repeat: Infinity, duration: 4, ease: "easeInOut" }}
    whileHover={{ scale: 1.15, rotate: -15 }}
    className="text-rose-400"
  >
    <Sunset className="w-5 h-5 drop-shadow-[0_0_8px_rgba(244,63,94,0.5)]" />
  </motion.div>
);

// 4. Night Icon (Rocking crescent moon + twinkling effect)
export const MotionNight = ({ active }) => (
  <motion.div
    animate={active ? { rotate: [-5, 10, -5] } : {}}
    transition={{ repeat: Infinity, duration: 5, ease: "easeInOut" }}
    whileHover={{ scale: 1.18, filter: "brightness(1.2)" }}
    className="text-indigo-400"
  >
    <Moon className="w-5 h-5 drop-shadow-[0_0_8px_rgba(129,140,248,0.5)]" />
  </motion.div>
);

// 5. Cross Day Icon (A sparkling, transitioning stars effect representing moving between dates)
export const MotionCrossDay = ({ active }) => (
  <motion.div
    animate={active ? { scale: [1, 1.1, 1], rotate: [0, 15, -15, 0] } : {}}
    transition={{ repeat: Infinity, duration: 3.5, ease: "easeInOut" }}
    whileHover={{ scale: 1.2 }}
    className="text-fuchsia-400"
  >
    <Sparkles className="w-5 h-5 drop-shadow-[0_0_10px_rgba(192,38,211,0.6)]" />
  </motion.div>
);

// Helper mapping object to render dynamically based on DB string reference
export const SHIFT_ICONS = {
  morning:   MotionMorning,
  day:       MotionDay,
  evening:   MotionEvening,
  night:     MotionNight,
  cross_day: MotionCrossDay,
};