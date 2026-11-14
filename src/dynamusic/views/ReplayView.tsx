import React from "react";
import { BarChart2, Flame, Headphones, Music } from "lucide-react";

export const ReplayView: React.FC = () => {
  return (
    <div className="pb-16 select-none">
      <div className="flex items-end gap-6 mb-8 p-6 -mx-10 -mt-5 bg-gradient-to-b from-[#db2777]/30 to-transparent">
        <div className="w-48 h-48 rounded-xl bg-gradient-to-br from-[#db2777] to-[#f43f5e] flex items-center justify-center shrink-0 shadow-2xl">
          <BarChart2 className="w-24 h-24 text-white" />
        </div>
        <div className="space-y-2">
          <div className="text-[12px] font-bold text-pink-400 uppercase tracking-wider">
            Listening Stats
          </div>
          <h1 className="text-[48px] font-black tracking-tight text-white leading-none">
            Replay
          </h1>
          <div className="text-[13.5px] font-medium text-white/80">
            Your personalized listening habits & milestones
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/[0.05]">
          <div className="flex items-center gap-2 text-orange-400 text-[13px] font-bold mb-2">
            <Flame className="w-4 h-4" />
            <span>Streak</span>
          </div>
          <div className="text-[32px] font-black text-white">9 Days</div>
          <div className="text-[12.5px] text-white/50 mt-1">Keep listening to extend your record</div>
        </div>

        <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/[0.05]">
          <div className="flex items-center gap-2 text-purple-400 text-[13px] font-bold mb-2">
            <Headphones className="w-4 h-4" />
            <span>Top Artist</span>
          </div>
          <div className="text-[28px] font-black text-white truncate">Temper City</div>
          <div className="text-[12.5px] text-white/50 mt-1">1,420 minutes listened this month</div>
        </div>

        <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/[0.05]">
          <div className="flex items-center gap-2 text-green-400 text-[13px] font-bold mb-2">
            <Music className="w-4 h-4" />
            <span>Top Track</span>
          </div>
          <div className="text-[28px] font-black text-white truncate">Self Aware</div>
          <div className="text-[12.5px] text-white/50 mt-1">Played 38 times</div>
        </div>
      </div>
    </div>
  );
};
