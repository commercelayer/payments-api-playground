"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
	loginCustomerToSalesChannel,
	logoutCustomerFromSalesChannel,
} from "@/lib/client";

export async function loginCustomer() {
	await loginCustomerToSalesChannel();
	revalidatePath("/");
	redirect("/");
}

export async function logoutCustomer() {
	await logoutCustomerFromSalesChannel();
	revalidatePath("/");
	redirect("/");
}
