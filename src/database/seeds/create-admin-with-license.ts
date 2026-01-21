import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { getRepositoryToken } from '@nestjs/typeorm';
import { User } from '../entities/user.entity';
import { License } from '../entities/license.entity';
import { hash } from 'bcryptjs';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const userRepository = app.get(getRepositoryToken(User));
  const licenseRepository = app.get(getRepositoryToken(License));

  const adminEmail = 'luan93dutra@gmail.com';
  const adminPassword = '210293';

  // Buscar ou criar admin
  let admin = await userRepository.findOne({ where: { email: adminEmail } });

  if (!admin) {
    const hashedPassword = await hash(adminPassword, 10);
    admin = userRepository.create({
      name: 'Administrador',
      email: adminEmail,
      password: hashedPassword,
      role: 'admin',
    });
    await userRepository.save(admin);
    console.log('✅ Usuário admin criado!');
  } else {
    console.log('ℹ️  Usuário admin já existe');
  }

  // Verificar licença
  let license = await licenseRepository.findOne({ where: { userId: admin.id } });

  if (!license) {
    // Criar licença VITALÍCIA (100 anos)
    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + 100);

    license = licenseRepository.create({
      userId: admin.id,
      isActive: true,
      expiresAt: expiresAt,
    });
    await licenseRepository.save(license);
    console.log('✅ Licença vitalícia criada para admin!');
  } else if (!license.isActive) {
    // Ativar licença existente
    license.isActive = true;
    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + 100);
    license.expiresAt = expiresAt;
    await licenseRepository.save(license);
    console.log('✅ Licença do admin reativada!');
  } else {
    console.log('ℹ️  Licença do admin já está ativa');
  }

  console.log('\n📋 Credenciais:');
  console.log('   Email:', adminEmail);
  console.log('   Senha:', adminPassword);
  console.log('   Licença: ATIVA até', license.expiresAt.toISOString());

  await app.close();
}

bootstrap().catch((error) => {
  console.error('❌ Erro:', error);
  process.exit(1);
});
