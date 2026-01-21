import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { getRepositoryToken } from '@nestjs/typeorm';
import { User } from '../entities/user.entity';
import { hash } from 'bcryptjs';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const userRepository = app.get(getRepositoryToken(User));

  const adminEmail = 'admin@clonepages.com';
  const adminPassword = 'Admin@2026';

  // Verificar se já existe
  const exists = await userRepository.findOne({ where: { email: adminEmail } });

  if (exists) {
    console.log('ℹ️  Usuário admin já existe:', adminEmail);
    console.log('   Use as credenciais existentes ou delete o usuário primeiro.');
  } else {
    const hashedPassword = await hash(adminPassword, 10);
    const admin = userRepository.create({
      name: 'Administrador',
      email: adminEmail,
      password: hashedPassword,
    });

    await userRepository.save(admin);
    console.log('✅ Usuário admin criado com sucesso!');
    console.log('   Email:', adminEmail);
    console.log('   Senha:', adminPassword);
    console.log('   ⚠️  IMPORTANTE: Altere a senha após o primeiro login!');
  }

  await app.close();
}

bootstrap().catch((error) => {
  console.error('❌ Erro ao criar admin:', error);
  process.exit(1);
});
