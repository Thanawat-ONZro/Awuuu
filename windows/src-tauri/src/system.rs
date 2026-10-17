use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Instant;
use serde::Serialize;
use windows::core::PCWSTR;
use windows::Win32::Foundation::{CloseHandle, FILETIME};
use windows::Win32::Storage::FileSystem::{GetDiskFreeSpaceExW, GetDriveTypeW};
const DRIVE_FIXED: u32 = 3;
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
use windows::Win32::System::Threading::{
    GetProcessTimes, GetSystemTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
};

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DiskStats {
    pub mount: String,
    pub free_gb: f64,
    pub total_gb: f64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ProcessStats {
    pub name: String,
    pub cpu_pct: f64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SystemStats {
    pub cpu_pct: f64,
    pub mem_used_mb: u64,
    pub mem_total_mb: u64,
    pub disks: Vec<DiskStats>,
    pub top: Vec<ProcessStats>,
}

struct CpuSnapshot {
    idle: u64,
    kernel: u64,
    user: u64,
    proc_times: HashMap<u32, (String, u64)>,
    time: Instant,
}

static PREV_SNAPSHOT: Mutex<Option<CpuSnapshot>> = Mutex::new(None);

fn filetime_to_u64(ft: &FILETIME) -> u64 {
    ((ft.dwHighDateTime as u64) << 32) | (ft.dwLowDateTime as u64)
}

fn sample_system_times() -> (u64, u64, u64) {
    let mut idle_ft = FILETIME::default();
    let mut kernel_ft = FILETIME::default();
    let mut user_ft = FILETIME::default();
    let _ = unsafe { GetSystemTimes(Some(&mut idle_ft), Some(&mut kernel_ft), Some(&mut user_ft)) };
    (
        filetime_to_u64(&idle_ft),
        filetime_to_u64(&kernel_ft),
        filetime_to_u64(&user_ft),
    )
}

fn sample_proc_times() -> HashMap<u32, (String, u64)> {
    let mut procs = HashMap::new();
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if let Ok(handle) = snapshot {
        let mut entry = PROCESSENTRY32W {
            dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };
        if unsafe { Process32FirstW(handle, &mut entry) }.is_ok() {
            loop {
                let pid = entry.th32ProcessID;
                if pid > 0 {
                    let len = entry
                        .szExeFile
                        .iter()
                        .position(|&c| c == 0)
                        .unwrap_or(entry.szExeFile.len());
                    let mut name = String::from_utf16_lossy(&entry.szExeFile[..len]);
                    if let Some(stripped) = name.strip_suffix(".exe") {
                        name = stripped.to_string();
                    }

                    if let Ok(proc_h) = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) } {
                        let mut creation = FILETIME::default();
                        let mut exit = FILETIME::default();
                        let mut kernel = FILETIME::default();
                        let mut user = FILETIME::default();
                        if unsafe { GetProcessTimes(proc_h, &mut creation, &mut exit, &mut kernel, &mut user) }.is_ok() {
                            let total_time = filetime_to_u64(&kernel) + filetime_to_u64(&user);
                            procs.insert(pid, (name, total_time));
                        }
                        let _ = unsafe { CloseHandle(proc_h) };
                    }
                }
                if unsafe { Process32NextW(handle, &mut entry) }.is_err() {
                    break;
                }
            }
        }
        let _ = unsafe { CloseHandle(handle) };
    }
    procs
}

fn sample_all() -> CpuSnapshot {
    let (idle, kernel, user) = sample_system_times();
    let proc_times = sample_proc_times();
    CpuSnapshot {
        idle,
        kernel,
        user,
        proc_times,
        time: Instant::now(),
    }
}

fn query_memory() -> (u64, u64) {
    let mut mem = MEMORYSTATUSEX {
        dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32,
        ..Default::default()
    };
    unsafe {
        if GlobalMemoryStatusEx(&mut mem).is_ok() {
            let total = mem.ullTotalPhys / (1024 * 1024);
            let avail = mem.ullAvailPhys / (1024 * 1024);
            (total.saturating_sub(avail), total)
        } else {
            (0, 0)
        }
    }
}

fn query_disks() -> Vec<DiskStats> {
    let mut disks = Vec::new();
    for c in b'A'..=b'Z' {
        let drive_letter = c as char;
        let path = format!("{}:\\\0", drive_letter);
        let wide: Vec<u16> = path.encode_utf16().collect();
        let drive_type = unsafe { GetDriveTypeW(PCWSTR(wide.as_ptr())) };
        if drive_type == DRIVE_FIXED {
            let mut free_bytes_avail = 0u64;
            let mut total_bytes = 0u64;
            let mut total_free_bytes = 0u64;
            let ok = unsafe {
                GetDiskFreeSpaceExW(
                    PCWSTR(wide.as_ptr()),
                    Some(&mut free_bytes_avail),
                    Some(&mut total_bytes),
                    Some(&mut total_free_bytes),
                )
            };
            if ok.is_ok() && total_bytes > 0 {
                let free_gb = (free_bytes_avail as f64) / (1024.0 * 1024.0 * 1024.0);
                let total_gb = (total_bytes as f64) / (1024.0 * 1024.0 * 1024.0);
                disks.push(DiskStats {
                    mount: format!("{}:", drive_letter),
                    free_gb: (free_gb * 10.0).round() / 10.0,
                    total_gb: (total_gb * 10.0).round() / 10.0,
                });
            }
        }
    }
    disks
}

#[tauri::command]
pub async fn system_stats() -> SystemStats {
    tauri::async_runtime::spawn_blocking(|| {
        let mut prev_lock = PREV_SNAPSHOT.lock().unwrap();

        let (prev_snap, current_snap) = match prev_lock.take() {
            Some(prev) if prev.time.elapsed().as_millis() >= 200 && prev.time.elapsed().as_secs() <= 10 => {
                let curr = sample_all();
                (prev, curr)
            }
            _ => {
                let first = sample_all();
                std::thread::sleep(std::time::Duration::from_millis(100));
                let second = sample_all();
                (first, second)
            }
        };

        // System CPU % delta
        let idle_delta = current_snap.idle.saturating_sub(prev_snap.idle);
        let kernel_delta = current_snap.kernel.saturating_sub(prev_snap.kernel);
        let user_delta = current_snap.user.saturating_sub(prev_snap.user);
        let total_sys_delta = kernel_delta + user_delta;

        let cpu_pct = if total_sys_delta > 0 {
            let busy = total_sys_delta.saturating_sub(idle_delta);
            let pct = (busy as f64 / total_sys_delta as f64) * 100.0;
            ((pct * 10.0).round() / 10.0).clamp(0.0, 100.0)
        } else {
            0.0
        };

        // Top processes by CPU delta
        let mut proc_deltas: Vec<ProcessStats> = Vec::new();
        if total_sys_delta > 0 {
            for (pid, (name, curr_time)) in &current_snap.proc_times {
                if let Some((_, prev_time)) = prev_snap.proc_times.get(pid) {
                    let proc_delta = curr_time.saturating_sub(*prev_time);
                    if proc_delta > 0 {
                        let proc_pct = (proc_delta as f64 / total_sys_delta as f64) * 100.0;
                        let rounded = ((proc_pct * 10.0).round() / 10.0).clamp(0.0, 100.0);
                        if rounded > 0.0 {
                            proc_deltas.push(ProcessStats {
                                name: name.clone(),
                                cpu_pct: rounded,
                            });
                        }
                    }
                }
            }
        }

        // Sort descending by CPU %, take top 5
        proc_deltas.sort_by(|a, b| b.cpu_pct.partial_cmp(&a.cpu_pct).unwrap_or(std::cmp::Ordering::Equal));
        proc_deltas.truncate(5);

        // Save current snapshot for next iteration
        *prev_lock = Some(current_snap);

        let (mem_used_mb, mem_total_mb) = query_memory();
        let disks = query_disks();

        SystemStats {
            cpu_pct,
            mem_used_mb,
            mem_total_mb,
            disks,
            top: proc_deltas,
        }
    })
    .await
    .unwrap_or(SystemStats {
        cpu_pct: 0.0,
        mem_used_mb: 0,
        mem_total_mb: 0,
        disks: Vec::new(),
        top: Vec::new(),
    })
}
