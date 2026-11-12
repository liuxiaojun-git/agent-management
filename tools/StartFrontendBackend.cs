using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;

internal static class StartFrontendBackend
{
    private static Process backend;

    private static void Main()
    {
        Console.CancelKeyPress += OnCancelKeyPress;

        try
        {
            string frontendDirectory = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
            DirectoryInfo parentDirectory = Directory.GetParent(frontendDirectory);
            string backendDirectory = parentDirectory == null ? null : Path.Combine(parentDirectory.FullName, "zhiyu-backend");

            EnsureProject(frontendDirectory, "前端");
            EnsureProject(backendDirectory, "后端");
            EnsureDependencies(frontendDirectory, "前端");
            EnsureDependencies(backendDirectory, "后端");

            if (IsPortListening(8081) || IsPortListening(3000))
            {
                Console.WriteLine("检测到前端或后端端口已被占用，可能已有一套服务在运行。");
                Console.WriteLine("请勿重复启动；可直接访问以下地址：");
                Console.WriteLine("前端：http://localhost:8081");
                Console.WriteLine("后端健康检查：http://localhost:3000/api/health");
                PrintWiredAddresses();
                WaitForKey();
                return;
            }

            Console.WriteLine("启动后端：http://localhost:3000/api/health");
            PrintWiredAddresses();
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
        catch (Exception error)
        {
            Console.Error.WriteLine("启动失败：" + error.Message);
            WaitForKey();
            Environment.ExitCode = 1;
        }
    }

    private static bool IsPortListening(int port)
    {
        using (TcpClient client = new TcpClient())
        {
            try
            {
                client.Connect(IPAddress.Loopback, port);
                return true;
            }
            catch (SocketException)
            {
                return false;
            }
        }
    }

    private static void WaitForKey()
    {
        if (Console.IsInputRedirected) return;
        Console.WriteLine("按任意键关闭此窗口。");
        Console.ReadKey(true);
    }

    private static void PrintWiredAddresses()
    {
        List<string> addresses = new List<string>();
        foreach (NetworkInterface networkInterface in NetworkInterface.GetAllNetworkInterfaces())
        {
            if (networkInterface.NetworkInterfaceType != NetworkInterfaceType.Ethernet
                || networkInterface.OperationalStatus != OperationalStatus.Up
                || IsVirtualAdapter(networkInterface.Description))
            {
                continue;
            }

            foreach (UnicastIPAddressInformation addressInfo in networkInterface.GetIPProperties().UnicastAddresses)
            {
                IPAddress address = addressInfo.Address;
                byte[] bytes = address.GetAddressBytes();
                if (address.AddressFamily == AddressFamily.InterNetwork
                    && !IPAddress.IsLoopback(address)
                    && !(bytes[0] == 169 && bytes[1] == 254))
                {
                    string value = address.ToString();
                    if (!addresses.Contains(value)) addresses.Add(value);
                }
            }
        }

        if (addresses.Count == 0)
        {
            Console.WriteLine("未检测到可用的有线 IPv4 地址。");
            return;
        }

        foreach (string address in addresses)
        {
            Console.WriteLine("有线访问：http://" + address + ":8081");
            Console.WriteLine("有线后端健康检查：http://" + address + ":3000/api/health");
        }
    }

    private static bool IsVirtualAdapter(string description)
    {
        string value = (description ?? String.Empty).ToLowerInvariant();
        return value.Contains("virtual")
            || value.Contains("vmware")
            || value.Contains("virtualbox")
            || value.Contains("hyper-v")
            || value.Contains("tap-windows")
            || value.Contains("vpn")
            || value.Contains("wintun");
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
