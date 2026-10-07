export const CUSTOMER_EMAIL = "john.doe@example.com";

/** Billing and shipping address of the orders the store page creates.
 * Commerce Layer only checks that the fields are filled in, not that they
 * belong to the country, so one placeholder address serves every market and
 * only the country comes from `CL_ADDRESS_COUNTRY_CODE`. The country still has
 * to be one the market ships to: shipping methods are picked by shipping zone,
 * and an order outside every zone gets none. */
export const ORDER_ADDRESS = {
	first_name: "John",
	last_name: "Doe",
	line_1: "123 Main St",
	city: "New York",
	zip_code: "10001",
	state_code: "NY",
	country_code: process.env.CL_ADDRESS_COUNTRY_CODE || "US",
	phone: "+1 212 000 0000",
};
