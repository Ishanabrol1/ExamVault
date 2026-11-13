import React from 'react';
import * as Phosphor from '@phosphor-icons/react';
import type { IconProps as PhosphorIconProps } from '@phosphor-icons/react';

type AnyIcon = React.ComponentType<any>;

function withDefaults(Icon: AnyIcon, defaultWeight: PhosphorIconProps['weight'] = 'duotone'): AnyIcon {
  const Wrapped = React.forwardRef<SVGSVGElement, any>(({ weight, ...props }, ref) => (
    <Icon ref={ref} weight={weight ?? defaultWeight} {...props} />
  ));
  Wrapped.displayName = (Icon as any).displayName || 'Icon';
  return Wrapped as AnyIcon;
}

const P = Phosphor as any;

// Spinner/loader
export const Loader2: React.FC<any> = ({ className = '', ...props }) => (
  <P.CircleNotch className={`animate-spin ${className}`.trim()} weight="bold" {...props} />
);
export const CircleNotch = withDefaults(P.CircleNotch, 'bold');

// Mapped exports (Lucide-compatible names)
export const Shield = withDefaults(P.Shield);
export const FileText = withDefaults(P.FileText);
export const PlusCircle = withDefaults(P.PlusCircle);
export const BarChart3 = withDefaults(P.ChartBar);
export const Users = withDefaults(P.Users);
export const BookOpen = withDefaults(P.BookOpen);
export const KeyRound = withDefaults(P.Key);
export const Key = withDefaults(P.Key);
export const Layers = withDefaults(P.Stack);
export const ChevronDown = withDefaults(P.CaretDown, 'bold');
export const ChevronRight = withDefaults(P.CaretRight, 'bold');
export const GitBranch = withDefaults(P.GitBranch);
export const Lock = withDefaults(P.Lock);
export const AlertCircle = withDefaults(P.WarningCircle);
export const AlertTriangle = withDefaults(P.Warning);
export const Archive = withDefaults(P.Archive);
export const ArrowLeft = withDefaults(P.ArrowLeft, 'bold');
export const ArrowRight = withDefaults(P.ArrowRight, 'bold');
export const CheckCircle = withDefaults(P.CheckCircle);
export const CheckCircle2 = withDefaults(P.CheckCircle);
export const Check = withDefaults(P.Check, 'bold');
export const Clock = withDefaults(P.Clock);
export const Copy = withDefaults(P.Copy);
export const Database = withDefaults(P.Database);
export const Download = withDefaults(P.DownloadSimple);
export const Edit3 = withDefaults(P.PencilSimple);
export const Eye = withDefaults(P.Eye);
export const EyeOff = withDefaults(P.EyeSlash);
export const FileCheck2 = withDefaults(P.File);
export const FileCode = withDefaults(P.FileCode);
export const FileSpreadsheet = withDefaults(P.FileCsv);
export const Filter = withDefaults(P.Funnel);
export const FolderTree = withDefaults(P.Folder);
export const GitCompare = withDefaults(P.GitDiff);
export const HardDrive = withDefaults(P.HardDrive);
export const HelpCircle = withDefaults(P.Question);
export const History = withDefaults(P.ClockCounterClockwise);
export const ImageIcon = withDefaults(P.Image);
export const Mail = withDefaults(P.Envelope);
export const MessageSquare = withDefaults(P.ChatCircle);
export const PieChart = withDefaults(P.ChartPie);
export const Play = withDefaults(P.Play);
export const Plus = withDefaults(P.Plus, 'bold');
export const RefreshCw = withDefaults(P.ArrowsClockwise);
export const RotateCcw = withDefaults(P.ArrowCounterClockwise);
export const Save = withDefaults(P.FloppyDisk);
export const Scale = withDefaults(P.Scales);
export const Search = withDefaults(P.MagnifyingGlass);
export const Send = withDefaults(P.PaperPlaneTilt);
export const ShieldAlert = withDefaults(P.ShieldWarning);
export const ShieldCheck = withDefaults(P.ShieldCheck);
export const Sliders = withDefaults(P.Sliders);
export const Sparkles = withDefaults(P.Sparkle);
export const Target = withDefaults(P.Target);
export const Trash2 = withDefaults(P.Trash);
export const Unlock = withDefaults(P.LockOpen);
export const UploadCloud = withDefaults(P.CloudArrowUp);
export const User = withDefaults(P.User);
export const UserCheck = withDefaults(P.UserCheck);
export const UserPlus = withDefaults(P.UserPlus);
export const Workflow = withDefaults(P.TreeStructure);
export const X = withDefaults(P.X, 'bold');
export const Activity = withDefaults(P.Pulse);
export const Blocks = withDefaults(P.SquaresFour);
export const FileEdit = withDefaults(P.FileArrowUp);
export const LogOut = withDefaults(P.SignOut);