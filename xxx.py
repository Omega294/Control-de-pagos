class Player:
    def __init__(self, name: str, team: str):
        self.name = name
        self.team = team
        self.payments = [] # Historial de pagos

    def add_payment(self, amount: float, currency: str, rate_eur_bs: float = None):
        """
        Registra un pago. 
        Si es en BS, necesitamos la tasa de cambio actual (EUR/BS) 
        para convertirlo a su equivalente en USD y rebajar la deuda base.
        """
        payment = {
            "amount": amount,
            "currency": currency.upper(),
        }
        
        if currency.upper() == 'BS':
            if rate_eur_bs is None:
                raise ValueError("Se requiere el precio del EUR/BS del día para registrar pagos en BS.")
            payment["rate_eur_bs"] = rate_eur_bs
            # Convertimos BS a EUR, y luego EUR a USD (descontando el recargo del 30%)
            # 1. amount_bs = amount_eur * rate_eur_bs => amount_eur = amount_bs / rate_eur_bs
            # 2. amount_eur = amount_usd * 1.30 => amount_usd = amount_eur / 1.30
            amount_eur = amount / rate_eur_bs
            amount_usd = amount_eur / 1.30
            payment["equivalent_usd"] = amount_usd
        elif currency.upper() in ['USD', 'DIVISAS']:
            payment["equivalent_usd"] = amount
        else:
            raise ValueError(f"Moneda no soportada: {currency}")
            
        self.payments.append(payment)

    def total_paid_usd(self) -> float:
        """Suma el equivalente en dólares de todos los pagos realizados (mixtos)."""
        return sum(p["equivalent_usd"] for p in self.payments)

class Tournament:
    def __init__(self, base_cost_usd: float):
        self.base_cost_usd = base_cost_usd # El costo original del torneo (ej: 100$)
        self.teams = {}
        
    def add_player(self, player: Player):
        if player.team not in self.teams:
            self.teams[player.team] = []
        self.teams[player.team].append(player)

    def get_player_debt(self, player: Player, current_rate_eur_bs: float) -> dict:
        """
        Calcula la deuda restante tanto en USD como en BS basándose en el saldo pendiente
        y el valor del euro del día.
        """
        paid_usd = player.total_paid_usd()
        remaining_usd = self.base_cost_usd - paid_usd
        
        if remaining_usd <= 0:
            return {"remaining_usd": 0.0, "remaining_bs": 0.0}

        # Para el costo en BS de lo que resta: 
        # (Restante en USD * 1.30 para llevar a EUR) * Precio del EUR/BS
        remaining_eur = remaining_usd * 1.30
        remaining_bs = remaining_eur * current_rate_eur_bs
        
        return {
            "remaining_usd": round(remaining_usd, 2),
            "remaining_bs": round(remaining_bs, 2)
        }

# ==========================================
# EJEMPLO DE USO
# ==========================================
if __name__ == "__main__":
    # 1. Inicializamos el torneo con un costo base en Divisas de $100
    torneo = Tournament(base_cost_usd=100.0)
    
    # 2. Creamos un jugador
    jugador1 = Player(name="Juan Pérez", team="Los Tigres")
    torneo.add_player(jugador1)
    
    # Tasa hipotética del día: 1 EUR = 40 BS
    TASA_EUR_BS_HOY = 40.0
    
    print("--- DEUDA INICIAL ---")
    deuda = torneo.get_player_debt(jugador1, current_rate_eur_bs=TASA_EUR_BS_HOY)
    print(f"Debe: {deuda['remaining_usd']}$ USD ó {deuda['remaining_bs']} BS")
    
    print("\n--- PAGO 1: Juan paga 20$ en Divisas ---")
    jugador1.add_payment(amount=20, currency='USD')
    deuda = torneo.get_player_debt(jugador1, current_rate_eur_bs=TASA_EUR_BS_HOY)
    print(f"Debe: {deuda['remaining_usd']}$ USD ó {deuda['remaining_bs']} BS")
    
    print("\n--- PAGO 2: Juan paga 1000 BS (a tasa de 40) ---")
    jugador1.add_payment(amount=1000, currency='BS', rate_eur_bs=TASA_EUR_BS_HOY)
    deuda = torneo.get_player_debt(jugador1, current_rate_eur_bs=TASA_EUR_BS_HOY)
    print(f"Debe: {deuda['remaining_usd']}$ USD ó {deuda['remaining_bs']} BS")
    
    print("\n--- PASAN LOS DÍAS: La tasa cambia a 45 BS por EUR ---")
    NUEVA_TASA = 45.0
    deuda_actualizada = torneo.get_player_debt(jugador1, current_rate_eur_bs=NUEVA_TASA)
    print(f"A la nueva tasa, Juan debe: {deuda_actualizada['remaining_usd']}$ USD ó {deuda_actualizada['remaining_bs']} BS")
