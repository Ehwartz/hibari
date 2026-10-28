// Hibari.exe: entry point of the portable release.
// Runs the bundled Python (runtime\python\pythonw.exe -m scripts.launch) from the exe's folder.
// Built by scripts/build_release.py with the .NET Framework csc.exe that ships with Windows.
using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

static class Program
{
    [STAThread]
    static void Main()
    {
        string dir = AppDomain.CurrentDomain.BaseDirectory;
        string python = Path.Combine(dir, "runtime", "python", "pythonw.exe");
        if (!File.Exists(python))
        {
            MessageBox.Show("找不到 runtime\\python\\pythonw.exe。\n请把压缩包完整解压后再运行 Hibari.exe。",
                "雲雀 Hibari", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }
        var psi = new ProcessStartInfo(python, "-m scripts.launch")
        {
            WorkingDirectory = dir,
            UseShellExecute = false,
        };
        // the bundled interpreter must not pick up another Python installation's settings
        foreach (string name in new[] { "PYTHONPATH", "PYTHONHOME", "PYTHONSTARTUP", "PYTHONUSERBASE", "VIRTUAL_ENV" })
            psi.EnvironmentVariables.Remove(name);
        psi.EnvironmentVariables["PYTHONNOUSERSITE"] = "1";
        Process.Start(psi);
    }
}
