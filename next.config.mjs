/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["imapflow", "nodemailer", "mailparser", "bullmq", "ioredis"],
};

export default nextConfig;
