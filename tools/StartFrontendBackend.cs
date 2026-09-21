using System;
using System.Diagnostics;
using System.IO;

internal static class StartFrontendBackend
{
    private static Process backend;

    private static void Main()
    {
        Console.CancelKeyPress += OnCancelKeyPress;

        string frontendDirectory = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
        DirectoryInfo parentDirectory = Directory.GetParent(frontendDirectory);
        string backendDirectory = parentDirectory == null ? null : Path.Combine(parentDirectory.FullName, "zhiyu-backend");

        EnsureProject(frontendDirectory, "前端");
        EnsureProject(backendDirectory, "后端");
        EnsureDependencies(frontendDirectory, "前端");
        EnsureDependencies(backendDirectory, "后端");

        Console.WriteLine("启动后端：http://localhost:3000/api/health");
        backend = StartNpm(backendDirectory, "run dev");

        try
        {
            Console.WriteLine("启动前端：http://localhost:8081");
            Console.WriteLine("关闭此窗口或按 Ctrl+C 会停止前后端服务。\n");
            Process frontend = StartNpm(frontendDirectory, "run dev");
            frontend.WaitForExit();
            StopProcessTree(frontend);
        }
        finally
        {
            StopProcessTree(backend);
        }
    }

    private static void EnsureProject(string directory, string name)
    {
        if (String.IsNullOrEmpty(directory) || !File.Exists(Path.Combine(directory, "package.json")))
        {
            throw new InvalidOperationException(name + "项目不存在或缺少 package.json：" + directory);
        }
    }

    private static void EnsureDependencies(string directory, string name)
    {
        if (Directory.Exists(Path.Combine(directory, "node_modules"))) return;

        Console.WriteLine("安装" + name + "依赖...");
        Process installer = StartNpm(directory, "install");
        installer.WaitForExit();
        if (installer.ExitCode != 0) throw new InvalidOperationException(name + "依赖安装失败。");
    }

    private static Process StartNpm(string workingDirectory, string arguments)
    {
        ProcessStartInfo startInfo = new ProcessStartInfo();
        // 通过 cmd.exe 调用 npm.cmd，避免 .NET 直接创建批处理进程的兼容性问题。
        startInfo.FileName = Environment.GetEnvironmentVariable("ComSpec") ?? "cmd.exe";
        startInfo.Arguments = "/d /s /c \"npm.cmd " + arguments + "\"";
        startInfo.WorkingDirectory = workingDirectory;
        startInfo.UseShellExecute = false;
        startInfo.CreateNoWindow = false;
        return Process.Start(startInfo);
    }

    private static void OnCancelKeyPress(object sender, ConsoleCancelEventArgs eventArgs)
    {
        eventArgs.Cancel = true;
        StopProcessTree(backend);
        Environment.Exit(0);
    }

    private static void StopProcessTree(Process process)
    {
        if (process == null || process.HasExited) return;

        ProcessStartInfo taskkill = new ProcessStartInfo();
        taskkill.FileName = "taskkill.exe";
        taskkill.Arguments = "/PID " + process.Id + " /T /F";
        taskkill.UseShellExecute = false;
        taskkill.CreateNoWindow = true;
        using (Process killer = Process.Start(taskkill))
        {
            killer.WaitForExit();
        }
    }
}
