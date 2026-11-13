using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;

namespace LightAFEditorLauncher
{
    static class Program
    {
        [STAThread]
        static void Main(string[] args)
        {
            string baseDir = AppDomain.CurrentDomain.BaseDirectory;
            string serverJs = Path.Combine(baseDir, "server.js");

            if (!File.Exists(serverJs))
            {
                MessageBox.Show(
                    "Could not find server.js in:\n" + baseDir,
                    "LightAF Editor",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
                return;
            }

            string fileToOpen = (args != null && args.Length > 0 && File.Exists(args[0])) ? args[0] : null;
            bool alreadyRunning = IsPortOpen("127.0.0.1", 4173);

            if (!alreadyRunning)
            {
                string localNode = Path.Combine(baseDir, "bin", "node.exe");
                string nodeExe = File.Exists(localNode) ? localNode : "node";

                try
                {
                    var psi = new ProcessStartInfo
                    {
                        FileName = nodeExe,
                        Arguments = "\"server.js\" --auto-exit",
                        WorkingDirectory = baseDir,
                        UseShellExecute = false,
                        CreateNoWindow = true,
                        WindowStyle = ProcessWindowStyle.Hidden
                    };
                    Process.Start(psi);
                }
                catch (Exception ex)
                {
                    MessageBox.Show(
                        "Failed to start Node.js (" + nodeExe + "):\n" + ex.Message,
                        "LightAF Editor",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Error
                    );
                    return;
                }

                for (int i = 0; i < 40; i++)
                {
                    if (IsPortOpen("127.0.0.1", 4173)) break;
                    Thread.Sleep(125);
                }
            }

            string importedId = null;
            if (!string.IsNullOrEmpty(fileToOpen))
            {
                importedId = ImportFile(fileToOpen, alreadyRunning);
                // If already running, the open window polls /api/pending-imports and loads it
                if (alreadyRunning) return;
            }

            string url = "http://127.0.0.1:4173";
            if (!string.IsNullOrEmpty(importedId))
            {
                url += "/?import=" + Uri.EscapeDataString(importedId);
            }

            string edgePath = FindEdge();
            if (!string.IsNullOrEmpty(edgePath))
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = edgePath,
                    Arguments = "--app=" + url + " --window-size=1360,840",
                    UseShellExecute = true
                });
            }
            else
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = url,
                    UseShellExecute = true
                });
            }
        }

        static bool IsPortOpen(string host, int port)
        {
            try
            {
                using (var client = new TcpClient())
                {
                    client.Connect(host, port);
                    return true;
                }
            }
            catch
            {
                return false;
            }
        }

        static string ImportFile(string filePath, bool queueForOpenWindow)
        {
            try
            {
                string escapedPath = filePath.Replace("\\", "\\\\").Replace("\"", "\\\"");
                string json = "{\"filePath\":\"" + escapedPath + "\",\"queue\":" + (queueForOpenWindow ? "true" : "false") + "}";
                byte[] bytes = Encoding.UTF8.GetBytes(json);

                var req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:4173/api/import-path");
                req.Method = "POST";
                req.ContentType = "application/json";
                req.ContentLength = bytes.Length;
                req.Timeout = 15000;

                using (var stream = req.GetRequestStream())
                {
                    stream.Write(bytes, 0, bytes.Length);
                }

                using (var resp = (HttpWebResponse)req.GetResponse())
                using (var reader = new StreamReader(resp.GetResponseStream(), Encoding.UTF8))
                {
                    string body = reader.ReadToEnd();
                    var m = Regex.Match(body, "\"id\"\\s*:\\s*\"([^\"]+)\"");
                    return m.Success ? m.Groups[1].Value : null;
                }
            }
            catch
            {
                return null;
            }
        }

        static string FindEdge()
        {
            string[] candidates = new string[]
            {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Microsoft", "Edge", "Application", "msedge.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Microsoft", "Edge", "Application", "msedge.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Microsoft", "Edge", "Application", "msedge.exe")
            };
            foreach (string path in candidates)
            {
                if (!string.IsNullOrEmpty(path) && File.Exists(path))
                    return path;
            }
            return null;
        }
    }
}
