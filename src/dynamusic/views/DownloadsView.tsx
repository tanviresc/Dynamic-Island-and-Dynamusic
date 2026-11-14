import React from "react";
import { ArrowDownToLine, CheckCircle2 } from "lucide-react";

export const DownloadsView: React.FC = () => {
  return (
    <div className="pb-16 select-none">
      <div className="flex items-end gap-6 mb-8 p-6 -mx-10 -mt-5 bg-gradient-to-b from-[#2563eb]/30 to-transparent">
        <div className="w-48 h-48 rounded-xl bg-[#2563eb] flex items-center justify-center shrink-0 shadow-2xl">
          <ArrowDownToLine className="w-24 h-24 text-white" />
        </div>
        <div className="space-y-2">
          <div className="text-[12px] font-bold text-blue-400 uppercase tracking-wider">
            Offline Storage
          </div>
          <h1 className="text-[48px] font-black tracking-tight text-white leading-none">
            Downloads
          </h1>
          <div className="text-[13.5px] font-medium text-white/80">
            0 downloaded tracks • Offline ready
          </div>
        </div>
      </div>

      <div className="p-12 text-center rounded-2xl bg-white/[0.02] border border-white/[0.05] flex flex-col items-center justify-center gap-3">
        <CheckCircle2 className="w-10 h-10 text-white/30" />
        <div className="text-[16px] font-bold text-white">No tracks downloaded yet</div>
        <p className="text-[13px] text-white/50 max-w-md">
          Downloaded songs are stored locally on your PC so you can listen even without an active internet connection.
        </p>
      </div>
    </div>
  );
};

