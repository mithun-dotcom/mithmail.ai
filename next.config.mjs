/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: { serverActions: { bodySizeLimit: "10mb" } },
  serverExternalPackages: ["imapflow", "nodemailer", "mailparser", "bullmq", "ioredis"],
};

export default nextConfig;
